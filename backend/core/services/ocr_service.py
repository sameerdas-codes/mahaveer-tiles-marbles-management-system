import os
import re
import json
from decimal import Decimal, InvalidOperation
from datetime import datetime
from pathlib import Path

import fitz  # PyMuPDF
from paddleocr import PaddleOCR


# ============================================================
# ENVIRONMENT
# ============================================================

# CPU OCR stability.
os.environ.setdefault("FLAGS_enable_pir_api", "1")

# Keep disabled for maximum compatibility with current setup.
os.environ.setdefault("FLAGS_use_mkldnn", "0")


# ============================================================
# CONFIGURATION
# ============================================================

# Minimum amount of native PDF text before we consider
# skipping PaddleOCR.
NATIVE_TEXT_MIN_CHARS = 120

# PDF render quality.
PDF_ZOOM = 1.10

# Maximum image dimension.
MAX_IMAGE_DIMENSION = 2200

# Keep CPU inference within the range benchmarked for this OCR model.
OCR_CPU_THREADS = max(1, min(4, os.cpu_count() or 4))

# Quantity * rate ~= amount tolerance.
AMOUNT_TOLERANCE = Decimal("2.00")


# ============================================================
# OCR ENGINE
# ============================================================

_OCR_ENGINE = None


def get_ocr_engine():
    """
    Create PaddleOCR only once.

    PaddleOCR model loading is expensive, so never recreate
    the engine for every page/bill.
    """
    global _OCR_ENGINE

    if _OCR_ENGINE is None:
        _OCR_ENGINE = PaddleOCR(
            lang="en",
            device="cpu",
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,
            use_textline_orientation=False,
            enable_mkldnn=False,
            cpu_threads=OCR_CPU_THREADS,
        )

    return _OCR_ENGINE


# ============================================================
# BASIC HELPERS
# ============================================================

def clean_text(value):
    if value is None:
        return ""

    value = str(value)

    value = value.replace("\x00", " ")
    value = value.replace("\r", " ")
    value = value.replace("\t", " ")

    return re.sub(r"\s+", " ", value).strip()


def normalize_spaces(value):
    return re.sub(r"\s+", " ", clean_text(value)).strip()


def normalize_product_name(value):
    """
    Used only for product comparison.

    Important:
        2PC != 3PC

    Examples:

        GLAZE VITRIFIED TILES-2PC
        GLAZE VITRIFIED TILES - 2 PC

    become comparable.

    But:

        GLAZE VITRIFIED TILES-2PC
        GLAZE VITRIFIED TILES-3PC

    remain different.
    """

    value = normalize_spaces(value).upper()

    value = value.replace("–", "-")
    value = value.replace("—", "-")

    # Normalize spaces around hyphen.
    value = re.sub(r"\s*-\s*", "-", value)

    # Normalize PC spacing.
    value = re.sub(r"\s+PC\b", "PC", value)

    return value


def parse_decimal(value, default=None):
    """
    Convert OCR number text into Decimal.

    Supports:
        20
        217
        217.00
        4,340.00
        ₹ 202,665.00
        Rs. 202665
    """

    if value is None:
        return default

    if isinstance(value, Decimal):
        return value

    text = clean_text(value)

    if not text:
        return default

    text = text.replace(",", "")
    text = text.replace("₹", "")
    text = text.replace("$", "")
    text = re.sub(r"\bRs\.?\b", "", text, flags=re.IGNORECASE)

    match = re.search(
        r"-?\d+(?:\.\d+)?",
        text,
    )

    if not match:
        return default

    try:
        return Decimal(match.group(0))
    except (InvalidOperation, ValueError):
        return default


def is_number(value):
    return parse_decimal(value, default=None) is not None


def is_integer_number(value):
    number = parse_decimal(value, default=None)

    if number is None:
        return False

    return number == number.to_integral_value()


def number_string(value):
    number = parse_decimal(value, default=None)

    if number is None:
        return ""

    if number == number.to_integral_value():
        return str(int(number))

    return f"{number:.2f}".rstrip("0").rstrip(".")


# ============================================================
# PRODUCT CODE / HSN / SIZE
# ============================================================

SIZE_PATTERN = re.compile(
    r"^\d{1,4}(?:\.\d+)?\s*[xX×]\s*"
    r"\d{1,4}(?:\.\d+)?"
    r"(?:\s*(?:MM|CM|M|FT|INCH|IN))?$",
    re.IGNORECASE,
)
SIZE_SEARCH_PATTERN = re.compile(
    r"(?<![A-Za-z0-9])"
    r"(\d{1,4}(?:\.\d+)?\s*[xX×]\s*"
    r"\d{1,4}(?:\.\d+)?"
    r"(?:\s*(?:MM|CM|M|FT|INCH|IN))?)"
    r"(?![A-Za-z0-9])",
    re.IGNORECASE,
)

WEIGHT_PATTERN = re.compile(
    r"(?<![A-Za-z0-9])"
    r"(\d+(?:[.,]\d+)?)\s*"
    r"(KG|KGS|G|GM|GMS|GRAM|GRAMS|LB|LBS|TON|TONS)\b",
    re.IGNORECASE,
)
WEIGHT_UNITS = {
    "KG",
    "KGS",
    "G",
    "GM",
    "GMS",
    "GRAM",
    "GRAMS",
    "LB",
    "LBS",
    "TON",
    "TONS",
}

HSN_PATTERN = re.compile(
    r"^\d{4,8}$"
)


def is_size_value(value):
    """
    Examples:

        600X1200
        600 x 1200
        800×1600
        300X450 MM
    """

    value = normalize_spaces(value)

    if not value:
        return False

    return bool(SIZE_PATTERN.match(value))


def find_size_tokens(tokens, start_index):
    for end_index in range(
        start_index + 1,
        min(start_index + 5, len(tokens) + 1),
    ):
        value = normalize_spaces(
            " ".join(tokens[start_index:end_index])
        )
        if is_size_value(value):
            return value, end_index - start_index

    return None, 0


def extract_weight_value(value):
    value = normalize_spaces(value)
    match = WEIGHT_PATTERN.search(value)

    if not match:
        return None

    amount = match.group(1).replace(",", ".")
    unit = match.group(2).upper()
    return f"{amount} {unit}"


def is_weight_value(value):
    value = normalize_spaces(value)
    return bool(WEIGHT_PATTERN.fullmatch(value))


def is_hsn_value(value):
    """
    4-8 digit numeric value is treated as HSN candidate.
    """

    value = clean_text(value).replace(" ", "")

    return bool(HSN_PATTERN.match(value))


def looks_like_product_code(value):
    """
    Product code is accepted only when clearly code-like.

    IMPORTANT:

        600X1200 -> size, NOT code
        69072100 -> HSN, NOT code
        12345    -> numeric value, NOT code
    """

    value = normalize_spaces(value)

    if not value:
        return False

    if is_size_value(value):
        return False

    if is_hsn_value(value):
        return False

    # Pure numbers are never product codes.
    if re.fullmatch(
        r"\d+(?:\.\d+)?",
        value,
    ):
        return False

    # Must contain alphabetic character.
    if not re.search(r"[A-Za-z]", value):
        return False

    # Code-like pattern.
    if re.fullmatch(
        r"[A-Za-z0-9][A-Za-z0-9._/\-]{2,40}",
        value,
    ):
        return True

    return False


# ============================================================
# DATE DETECTION
# ============================================================

DATE_PATTERNS = [
    r"\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b",
    r"\b\d{1,2}\.\d{1,2}\.\d{2,4}\b",
    r"\b\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{2,4}\b",
    r"\b[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4}\b",
]


def parse_date_value(value):
    if not value:
        return None

    value = clean_text(value)

    formats = [
        "%d/%m/%Y",
        "%d-%m-%Y",
        "%d.%m.%Y",
        "%d/%m/%y",
        "%d-%m-%y",
        "%d.%m.%y",
        "%d %B %Y",
        "%d %b %Y",
        "%d %B, %Y",
        "%d %b, %Y",
        "%B %d %Y",
        "%b %d %Y",
        "%B %d, %Y",
        "%b %d, %Y",
    ]

    for fmt in formats:
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue

    return None


def find_dates(text):
    """
    Return all valid dates found in OCR/native text.
    """

    text = clean_text(text)

    results = []

    for pattern in DATE_PATTERNS:
        for match in re.finditer(
            pattern,
            text,
            flags=re.IGNORECASE,
        ):
            raw = clean_text(match.group(0))

            parsed = parse_date_value(raw)

            if parsed:
                results.append(
                    {
                        "raw": raw,
                        "date": parsed,
                        "position": match.start(),
                    }
                )

    unique = {}

    for item in results:
        key = (
            item["date"],
            item["position"],
        )

        if key not in unique:
            unique[key] = item

    return list(unique.values())


# ============================================================
# INVOICE NUMBER
# ============================================================

INVOICE_NUMBER_PATTERNS = [
    re.compile(
        r"(?:invoice\s*(?:no|number|#)?|"
        r"involce\s*(?:no|number|#)?|"
        r"inv(?:oice)?\s*(?:no|number|#)?|"
        r"bill\s*(?:no|number|#)?)"
        r"\s*[:#\-]?\s*"
        r"([A-Za-z0-9][A-Za-z0-9./_\-]{3,50})",
        re.IGNORECASE,
    ),
]


def clean_invoice_number(value):
    if not value:
        return ""

    value = clean_text(value)
    value = value.strip(" :#-")

    # Date is not invoice number.
    if re.fullmatch(
        r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}",
        value,
    ):
        return ""

    if re.fullmatch(
        r"\d{1,2}\.\d{1,2}\.\d{2,4}",
        value,
    ):
        return ""

    return value


def extract_invoice_number(lines, full_text):
    """
    Handles:

        Invoice Number : ALSK/2627-2056

    and:

        Invoice Number & Date : ALSK/2627-2056 18/09/2026
    """

    # --------------------------------------------------------
    # Highest priority:
    # Invoice Number & Date
    # --------------------------------------------------------

    special_pattern = re.compile(
        r"(?:invoice|involce|inv(?:oice)?)"
        r"\s*(?:number|no|#)?"
        r".{0,60}?"
        r"[:\-]\s*"
        r"([A-Za-z0-9][A-Za-z0-9./_\-]{3,50})"
        r"\s+"
        r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}",
        re.IGNORECASE,
    )

    for line in lines:
        clean_line = clean_text(line)

        if not clean_line:
            continue

        match = special_pattern.search(clean_line)

        if match:
            candidate = clean_invoice_number(
                match.group(1)
            )

            if candidate:
                return candidate

    # --------------------------------------------------------
    # Normal invoice number patterns
    # --------------------------------------------------------

    for line in lines:
        clean_line = clean_text(line)

        if not clean_line:
            continue

        if clean_line.lower() == "tax invoice":
            continue

        for pattern in INVOICE_NUMBER_PATTERNS:
            match = pattern.search(clean_line)

            if match:
                candidate = clean_invoice_number(
                    match.group(1)
                )

                if candidate:
                    return candidate

    # --------------------------------------------------------
    # Full text fallback
    # --------------------------------------------------------

    for pattern in INVOICE_NUMBER_PATTERNS:
        match = pattern.search(full_text)

        if match:
            candidate = clean_invoice_number(
                match.group(1)
            )

            if candidate:
                return candidate

    return ""


# ============================================================
# INVOICE DATE
# ============================================================

def extract_invoice_date(lines, full_text):
    """
    Priority:

    1. Invoice Number & Date
    2. Explicit Invoice Date
    3. Explicit Bill Date
    4. Single date
    5. Closest date to invoice/bill
    """

    # Dates can be emitted on a separate OCR line from the
    # "Invoice Number & Date" heading. Associate that date with
    # the heading before considering unrelated dates elsewhere.
    labelled_date_pattern = re.compile(
        r"(?:"
        r"(?:invoice|involce|inv(?:oice)?)"
        r"\s*(?:(?:number|no|#)\s*)?(?:&|and)\s*date"
        r"|invoice\s*date"
        r"|bill\s*date"
        r"|date\s*of\s*invoice"
        r")\b",
        re.IGNORECASE,
    )

    for index, line in enumerate(lines):
        clean_line = clean_text(line)
        label_match = labelled_date_pattern.search(clean_line)
        if not label_match:
            continue

        dates_after_label = find_dates(
            clean_line[label_match.end():]
        )
        if dates_after_label:
            return dates_after_label[0]["date"]

        for following_line in lines[index + 1:index + 4]:
            following_text = clean_text(following_line)
            if not following_text:
                continue

            following_dates = find_dates(following_text)
            if following_dates:
                return following_dates[0]["date"]

    # --------------------------------------------------------
    # 1. Invoice Number & Date
    # --------------------------------------------------------

    priority_patterns = [
        re.compile(
            r"(?:invoice|involce|inv(?:oice)?)"
            r".{0,100}?"
            r"(?:number|no|#)?"
            r".{0,50}?"
            r"(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})",
            re.IGNORECASE,
        ),
        re.compile(
            r"(?:invoice|involce|inv(?:oice)?)"
            r".{0,120}?"
            r"(\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{2,4})",
            re.IGNORECASE,
        ),
    ]

    for line in lines:
        clean_line = clean_text(line)

        if not clean_line:
            continue

        for pattern in priority_patterns:
            match = pattern.search(clean_line)

            if match:
                parsed = parse_date_value(
                    match.group(1)
                )

                if parsed:
                    return parsed

    # --------------------------------------------------------
    # 2. Explicit invoice/bill date
    # --------------------------------------------------------

    explicit_patterns = [
        re.compile(
            r"(?:invoice\s*date|"
            r"bill\s*date|"
            r"date\s*of\s*invoice)"
            r"\s*[:\-]?\s*"
            r"(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})",
            re.IGNORECASE,
        ),
        re.compile(
            r"(?:invoice\s*date|"
            r"bill\s*date|"
            r"date\s*of\s*invoice)"
            r"\s*[:\-]?\s*"
            r"(\d{1,2}\.\d{1,2}\.\d{2,4})",
            re.IGNORECASE,
        ),
        re.compile(
            r"(?:invoice\s*date|"
            r"bill\s*date|"
            r"date\s*of\s*invoice)"
            r"\s*[:\-]?\s*"
            r"(\d{1,2}\s+[A-Za-z]{3,9},?\s+\d{2,4})",
            re.IGNORECASE,
        ),
    ]

    for line in lines:
        clean_line = clean_text(line)

        for pattern in explicit_patterns:
            match = pattern.search(clean_line)

            if match:
                parsed = parse_date_value(
                    match.group(1)
                )

                if parsed:
                    return parsed

    # --------------------------------------------------------
    # 3. Single date
    # --------------------------------------------------------

    dates = find_dates(full_text)

    if len(dates) == 1:
        return dates[0]["date"]

    # --------------------------------------------------------
    # 4. Closest date to invoice/bill
    # --------------------------------------------------------

    invoice_positions = []

    for match in re.finditer(
        r"(invoice|involce|bill)",
        full_text,
        flags=re.IGNORECASE,
    ):
        invoice_positions.append(
            match.start()
        )

    if invoice_positions:
        best = None
        best_distance = None

        for item in dates:
            distance = min(
                abs(
                    item["position"] - position
                )
                for position in invoice_positions
            )

            if (
                best is None
                or distance < best_distance
            ):
                best = item
                best_distance = distance

        if best:
            return best["date"]

    return None


# ============================================================
# TAX / GRAND TOTAL
# ============================================================

AMOUNT_PATTERN = re.compile(
    r"(?<![\d.])"
    r"(?:\d{1,3}(?:,\d{3})+|\d+)"
    r"(?:\.\d{1,2})?"
    r"(?![\d.])",
)


def extract_labeled_amount(lines, labels):
    """
    Extract amount from an explicitly labelled line.

    Examples:

        Total Tax : 30915.00
        Grand Total : 202665.00
    """

    for line in lines:
        clean_line = normalize_spaces(line)

        if not clean_line:
            continue

        for label in labels:
            if label.lower() not in clean_line.lower():
                continue

            parts = re.split(
                re.escape(label),
                clean_line,
                maxsplit=1,
                flags=re.IGNORECASE,
            )

            if len(parts) < 2:
                continue

            tail = parts[1]

            matches = AMOUNT_PATTERN.findall(tail)

            if not matches:
                continue

            value = parse_decimal(
                matches[-1],
                default=None,
            )

            if value is not None:
                return value

    return Decimal("0")


def extract_tax(lines):
    return extract_labeled_amount(
        lines,
        [
            "Total Tax",
            "Tax Amount",
            "Total GST",
            "GST Amount",
            "GST Total",
            "Total Taxable GST",
        ],
    )


def extract_grand_total(lines):
    labels = [
        "Grand Total",
        "Grand Total Amount",
        "Net Payable",
        "Net Amount",
        "Invoice Total",
        "Total Amount",
        "Amount Payable",
    ]

    for index, line in enumerate(lines):
        clean_line = normalize_spaces(line)

        if not clean_line:
            continue

        for label in labels:
            if label.lower() not in clean_line.lower():
                continue

            parts = re.split(
                re.escape(label),
                clean_line,
                maxsplit=1,
                flags=re.IGNORECASE,
            )

            if len(parts) < 2:
                continue

            matches = AMOUNT_PATTERN.findall(parts[1])

            if matches:
                value = parse_decimal(
                    matches[-1],
                    default=None,
                )

                if value is not None:
                    return value

            # OCR often puts a labeled total and its amount on
            # separate lines. Only accept a standalone next-line amount.
            if index + 1 < len(lines):
                next_line = normalize_spaces(lines[index + 1])

                if re.fullmatch(
                    r"(?:Rs\.?\s*)?\d[\d,]*(?:\.\d{1,2})?",
                    next_line,
                    flags=re.IGNORECASE,
                ):
                    value = parse_decimal(
                        next_line,
                        default=None,
                    )

                    if value is not None:
                        return value

    return Decimal("0")


# ============================================================
# SUPPLIER
# ============================================================

SUPPLIER_IGNORED_WORDS = {
    "tax invoice",
    "gstin",
    "invoice",
    "date",
    "phone",
    "mobile",
    "email",
    "address",
    "state",
    "pin",
    "contact",
    "original",
    "duplicate",
    "buyer",
    "consignee",
    "ship to",
    "bill to",
}


def looks_like_supplier_name(value):
    """
    Conservative supplier/company-name detection.

    Prevents table headers and common document metadata
    from being returned as supplier.
    """

    value = normalize_spaces(value)

    if not value:
        return False

    lower = value.lower()

    if len(value) < 3:
        return False

    if any(
        word in lower
        for word in SUPPLIER_IGNORED_WORDS
    ):
        return False

    if not re.search(
        r"[A-Za-z]",
        value,
    ):
        return False

    if is_size_value(value):
        return False

    if is_hsn_value(value):
        return False

    return True


def extract_supplier(lines):
    """
    Extract supplier/vendor name.

    Example:

        ALASKA SURFACES LLP
    """

    label_patterns = [
        re.compile(
            r"\b(?:supplier|seller|vendor|sold\s*by|from|for)\b"
            r"\s*[:,\-]\s*(.+)$",
            re.IGNORECASE,
        ),
    ]

    # --------------------------------------------------------
    # Explicit supplier/seller/vendor label
    # --------------------------------------------------------

    for line in lines:
        clean_line = clean_text(line)

        if not clean_line:
            continue

        for pattern in label_patterns:
            match = pattern.search(clean_line)

            if match:
                value = clean_text(
                    match.group(1)
                )

                if looks_like_supplier_name(value):
                    return value

    # --------------------------------------------------------
    # GSTIN context
    # --------------------------------------------------------

    for index, line in enumerate(lines):
        clean_line = clean_text(line)

        if "GSTIN" not in clean_line.upper():
            continue

        start = max(
            0,
            index - 8,
        )

        candidates = []

        for previous in lines[start:index]:
            candidate = clean_text(previous)

            if not candidate:
                continue

            lower = candidate.lower()

            if any(
                word in lower
                for word in SUPPLIER_IGNORED_WORDS
            ):
                continue

            if len(candidate) < 3:
                continue

            if not re.search(
                r"[A-Za-z]",
                candidate,
            ):
                continue

            candidates.append(candidate)

        if candidates:
            # Prefer company-like names.
            for candidate in candidates:
                upper = candidate.upper()

                if any(
                    suffix in upper
                    for suffix in [
                        "LLP",
                        "PVT",
                        "PRIVATE",
                        "LIMITED",
                        "LTD",
                        "TRADERS",
                        "ENTERPRISE",
                        "ENTERPRISES",
                        "INDUSTRIES",
                    ]
                ):
                    return candidate

            return candidates[-1]

    return ""


def get_supplier_footer_start(lines):
    """Find a likely supplier-contact footer near the end of a bill."""
    strong_footer_marker = re.compile(
        r"\b(?:registered\s+office|corporate\s+office|head\s+office|"
        r"branch\s+office|supplier\s+details|seller\s+details)\b",
        re.IGNORECASE,
    )
    tail_start = max(0, len(lines) - 36)
    for index in range(len(lines) - 1, tail_start - 1, -1):
        if strong_footer_marker.search(lines[index]):
            return index

    footer_markers = re.compile(
        r"\b(?:registered\s+office|corporate\s+office|head\s+office|"
        r"branch\s+office|contact(?:\s*us)?|phone|ph|mobile|mob|"
        r"telephone|tel|address|gstin|gst\s*(?:no|number)|"
        r"e-?mail|website)\b|@",
        re.IGNORECASE,
    )
    marker_indexes = [
        index
        for index in range(tail_start, len(lines))
        if footer_markers.search(lines[index])
    ]
    if not marker_indexes:
        return None

    cluster_start = marker_indexes[-1]
    for index in reversed(marker_indexes[:-1]):
        if cluster_start - index > 7:
            break
        cluster_start = index
    return cluster_start


def extract_supplier_gstin(lines):
    """Extract the supplier GSTIN from its header or bill footer."""
    buyer_start = next(
        (
            index
            for index, line in enumerate(lines)
            if re.search(
                r"\b(?:details of receiver|buyer details|buyer)\b",
                line,
                re.IGNORECASE,
            )
        ),
        len(lines),
    )
    gstin_pattern = re.compile(
        r"(?<![A-Z0-9])(\d{2}[A-Z0-9]{13})(?![A-Z0-9])",
        re.IGNORECASE,
    )

    def find_gstin(section, prefer_last=False):
        found_gstins = []
        for position, (_, line) in enumerate(section):
            if re.search(
                r"\b(?:buyer|receiver|consignee|bill\s*to|ship\s*to)\b",
                line,
                re.IGNORECASE,
            ):
                continue
            match = gstin_pattern.search(line)
            if match:
                found_gstins.append(match.group(1).upper())
                continue
            if re.search(r"\b(?:gstin|gst\s*(?:no|number))\b", line, re.IGNORECASE):
                for _, next_line in section[position + 1:position + 3]:
                    next_match = gstin_pattern.search(next_line)
                    if next_match:
                        found_gstins.append(next_match.group(1).upper())
                        break
        if not found_gstins:
            return ""
        return found_gstins[-1] if prefer_last else found_gstins[0]

    supplier_gstin = find_gstin(list(enumerate(lines[:buyer_start])))
    if supplier_gstin:
        return supplier_gstin

    footer_start = get_supplier_footer_start(lines)
    if footer_start is not None:
        footer_gstin = find_gstin(
            list(enumerate(lines[footer_start:], footer_start)),
            prefer_last=True,
        )
        if footer_gstin:
            return footer_gstin

    return ""


def extract_supplier_phone(lines):
    """Extract phone from supplier details, preferring the bill footer."""
    phone_pattern = re.compile(
        r"(?<!\d)(?:\+?91[\s()./-]*)?(?:0[\s()./-]*)?"
        r"([2-9](?:[\s()./-]*\d){9})(?!\d)"
    )
    contact_label = re.compile(
        r"\b(?:contact(?:\s*us)?|conta[co]t\s*us|phone|ph|mobile|mob|"
        r"telephone|tel|cell)\b",
        re.IGNORECASE,
    )
    label_only = re.compile(
        r"^\s*(?:contact(?:\s*us)?|conta[co]t\s*us|phone|ph|mobile|mob|"
        r"telephone|tel|cell)(?:\s*(?:no|number))?\.?\s*[:#\-]?\s*$",
        re.IGNORECASE,
    )

    buyer_start = next(
        (
            index
            for index, line in enumerate(lines)
            if re.search(
                r"\b(?:details of receiver|buyer details|buyer)\b",
                line,
                re.IGNORECASE,
            )
        ),
        len(lines),
    )

    seller_lines = lines[:buyer_start]
    for index, line in enumerate(seller_lines):
        if not contact_label.search(line):
            continue
        match = phone_pattern.search(line)
        if match:
            return re.sub(r"\D", "", match.group(0))

        # Bills often place a short phone label and the digits on
        # separate OCR lines. Only inspect the immediately following
        # line when the current line contains nothing but that label.
        next_lines = []
        for next_line in seller_lines[index + 1:index + 3]:
            if re.search(r"[A-Za-z]", next_line):
                break
            next_lines.append(next_line)

        if next_lines:
            candidate = " ".join(
                [line, *next_lines]
                if not label_only.fullmatch(line)
                else next_lines
            )
            match = phone_pattern.search(candidate)
            if match:
                return re.sub(r"\D", "", match.group(0))

    footer_start = get_supplier_footer_start(lines)
    if footer_start is not None:
        footer_lines = lines[footer_start:]
        phone_matches = []
        for index, line in enumerate(footer_lines):
            match = phone_pattern.search(line)
            if match:
                phone_matches.append((index, match.group(0)))
                continue
            if contact_label.search(line):
                candidate_lines = footer_lines[index + 1:index + 3]
                candidate = " ".join(candidate_lines)
                match = phone_pattern.search(candidate)
                if match:
                    phone_matches.append((index, match.group(0)))
        if phone_matches:
            return re.sub(r"\D", "", phone_matches[-1][1])

    return ""


# ============================================================
# PADDLE OCR RESULT HELPERS
# ============================================================

def _safe_get(obj, key, default=None):
    if obj is None:
        return default

    if isinstance(obj, dict):
        return obj.get(
            key,
            default,
        )

    try:
        return getattr(
            obj,
            key,
            default,
        )
    except Exception:
        return default


def extract_texts_from_paddle_result(result):
    """
    Supports common PaddleOCR 3.x result structures.
    """

    texts = []

    # --------------------------------------------------------
    # Case 1: result.json
    # --------------------------------------------------------

    json_data = _safe_get(
        result,
        "json",
        None,
    )

    if callable(json_data):
        try:
            json_data = json_data()
        except Exception:
            json_data = None

    if isinstance(json_data, str):
        try:
            json_data = json.loads(
                json_data
            )
        except Exception:
            json_data = None

    if isinstance(json_data, dict):
        data = json_data.get(
            "res",
            json_data,
        )

        for key in [
            "rec_texts",
            "texts",
            "text",
        ]:
            values = data.get(key)

            if isinstance(values, list):
                for value in values:
                    value = clean_text(value)

                    if value:
                        texts.append(value)

                if texts:
                    return texts

    # --------------------------------------------------------
    # Case 2: result.rec_texts
    # --------------------------------------------------------

    rec_texts = _safe_get(
        result,
        "rec_texts",
        None,
    )

    if rec_texts is not None:
        try:
            values = list(rec_texts)

            for value in values:
                value = clean_text(value)

                if value:
                    texts.append(value)

            if texts:
                return texts

        except Exception:
            pass

    # --------------------------------------------------------
    # Case 3: dict["rec_texts"]
    # --------------------------------------------------------

    if isinstance(result, dict):
        values = result.get(
            "rec_texts"
        )

        if isinstance(values, list):
            for value in values:
                value = clean_text(value)

                if value:
                    texts.append(value)

            if texts:
                return texts

    # --------------------------------------------------------
    # Case 4: list
    # --------------------------------------------------------

    if isinstance(result, list):
        for item in result:
            if isinstance(item, str):
                item = clean_text(item)

                if item:
                    texts.append(item)

    return texts


# ============================================================
# PADDLE OCR
# ============================================================

def run_paddle_ocr_on_image(image_path):
    """
    Run PaddleOCR on one image.
    """

    ocr = get_ocr_engine()

    result_lines = []

    try:
        results = ocr.predict(
            str(image_path)
        )

        if results is None:
            return []

        try:
            iterator = iter(results)
        except TypeError:
            iterator = iter([results])

        for result in iterator:
            result_lines.extend(
                extract_texts_from_paddle_result(
                    result
                )
            )

    except Exception as exc:
        raise RuntimeError(
            f"PaddleOCR failed for {image_path}: {exc}"
        ) from exc

    return result_lines


# ============================================================
# PDF NATIVE TEXT EXTRACTION
# ============================================================

def extract_native_pdf_text(pdf_path):
    """
    Extract selectable native PDF text.

    Returns:
        text_lines, page_count
    """

    pdf_path = Path(pdf_path)

    document = fitz.open(
        str(pdf_path)
    )

    all_lines = []

    page_count = len(document)

    try:
        for page_index in range(page_count):
            page = document.load_page(
                page_index
            )

            text = page.get_text(
                "text"
            )

            text = clean_text(text)

            if text:
                page_lines = [
                    normalize_spaces(line)
                    for line in text.splitlines()
                    if normalize_spaces(line)
                ]

                all_lines.extend(
                    page_lines
                )

            all_lines.append(
                f"--- PAGE {page_index + 1} END ---"
            )

    finally:
        document.close()

    return all_lines, page_count


def get_pdf_native_text(pdf_path):
    """
    Safely return native PDF text and page count.
    """

    return extract_native_pdf_text(
        pdf_path
    )


# ============================================================
# PDF TO IMAGES
# ============================================================

def render_pdf_to_images(
    pdf_path,
    output_dir=None,
    zoom=PDF_ZOOM,
):
    """
    Render PDF pages into JPG files.
    """

    pdf_path = Path(pdf_path)

    if not pdf_path.exists():
        raise FileNotFoundError(
            f"PDF file not found: {pdf_path}"
        )

    if output_dir is None:
        output_dir = (
            pdf_path.parent
            / f"{pdf_path.stem}_ocr_pages"
        )

    output_dir = Path(output_dir)

    output_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    page_paths = []

    document = fitz.open(
        str(pdf_path)
    )

    try:
        matrix = fitz.Matrix(
            zoom,
            zoom,
        )

        for page_index in range(
            len(document)
        ):
            page = document.load_page(
                page_index
            )

            pixmap = page.get_pixmap(
                matrix=matrix,
                alpha=False,
            )

            page_path = (
                output_dir
                / f"{pdf_path.stem}_page_{page_index + 1}.jpg"
            )

            pixmap.save(
                str(page_path)
            )

            page_paths.append(
                page_path
            )

    finally:
        document.close()

    return page_paths


# ============================================================
# PRODUCT PARSING
# ============================================================

STOP_WORDS = {
    "total",
    "subtotal",
    "grand",
    "tax",
    "gst",
    "cgst",
    "sgst",
    "igst",
    "amount",
    "discount",
    "round",
    "net",
    "payable",
    "terms",
    "bank",
    "signature",
    "authorized",
    "thanks",
    "thank",
}


# ------------------------------------------------------------
# Explicit non-product lines
# ------------------------------------------------------------

NON_PRODUCT_LINE_PATTERNS = [
    r"^pre$",
    r"^pcs?$",
    r"^box$",
    r"^nos$",
    r"^kg[s]?$",
    r"^sq\.?\s*ft$",
    r"^sqft$",
    r"^sqm$",

    r"^freight\b",
    r"^freight\s+on\b",
    r"^integrated\s+ta\b",
    r"^integrated\s+tax\b",
    r"^discount\b",
    r"^insurance\b",
    r"^other\s+details\b",
    r"^packing\b",
    r"^handling\b",
    r"^transport\b",

    r"^tax invoice$",
    r"^details of receiver\b",
    r"^details of consignee\b",
    r"^buyer details\b",
    r"^shipped detail\b",

    r"^description of goods$",
    r"^description$",
    r"^grade$",
    r"^hsn$",
    r"^size$",
    r"^rate$",
    r"^amount$",
    r"^qty$",
    r"^quantity$",
    r"^unit$",
    r"^gst$",
    r"^taxable$",
    r"^price$",
    r"^value$",
    r"^total$",
]


def is_non_product_line(line):
    """
    Detect known document/table/charge lines that must
    never become products.
    """

    line = normalize_spaces(line)

    if not line:
        return True

    lower = line.lower()

    for pattern in NON_PRODUCT_LINE_PATTERNS:
        if re.match(
            pattern,
            lower,
            re.IGNORECASE,
        ):
            return True

    return False


def looks_like_summary_line(line):
    lower = normalize_spaces(
        line
    ).lower()

    if not lower:
        return True

    summary_words = [
        "grand total",
        "total tax",
        "total gst",
        "subtotal",
        "net payable",
        "net amount",
        "tax amount",
        "cgst",
        "sgst",
        "igst",
        "round off",
        "rounding",
        "total amount",
        "invoice total",
        "amount payable",
    ]

    for word in summary_words:
        if word in lower:
            return True

    return False


def looks_like_product_name(line):
    """
    Conservative product-name detection.

    Must reject:

        PRE
        FREIGHT ON SA
        INTEGRATED TA
        DISCOUNT
        INSURANCE
        table headers
        tax/summary lines
    """

    line = normalize_spaces(line)

    if not line:
        return False

    if is_non_product_line(line):
        return False

    lower = line.lower()

    if re.match(
        r"^(?:size|weight|net\s+weight|gross\s+weight)\s*[:\-]",
        lower,
    ):
        return False

    if lower in STOP_WORDS:
        return False

    if looks_like_summary_line(line):
        return False

    if is_size_value(line):
        return False

    if is_weight_value(line):
        return False

    if is_hsn_value(line):
        return False

    # Dates.
    if re.fullmatch(
        r"\d{1,2}[/-]\d{1,2}[/-]\d{2,4}",
        line,
    ):
        return False

    if re.fullmatch(
        r"\d{1,2}\.\d{1,2}\.\d{2,4}",
        line,
    ):
        return False

    # Pure numeric.
    if re.fullmatch(
        r"[\d,]+(?:\.\d+)?",
        line,
    ):
        return False

    # Percentage.
    if re.fullmatch(
        r"\d+(?:\.\d+)?\s*%",
        line,
    ):
        return False

    if len(line) <= 3:
        return False

    heading_words = {
        "description",
        "product",
        "item",
        "qty",
        "quantity",
        "rate",
        "amount",
        "hsn",
        "code",
        "size",
        "weight",
        "unit",
        "gst",
        "taxable",
        "price",
        "value",
        "total",
        "grade",
        "box",
        "sqm",
        "pre",
    }

    if lower in heading_words:
        return False

    # Must contain letters.
    if not re.search(
        r"[A-Za-z]",
        line,
    ):
        return False

    # Common charges / adjustments.
    charge_words = [
        "freight",
        "insurance",
        "discount",
        "integrated ta",
        "integrated tax",
        "round off",
        "transport",
        "packing",
        "handling",
    ]

    if any(
        word in lower
        for word in charge_words
    ):
        return False

    return True


# ============================================================
# PRODUCT METADATA
# ============================================================

def extract_code_size_hsn_from_tokens(tokens):
    """
    Separate:

        product_code
        size
        HSN
    """

    product_code = None
    size = None
    weight = None
    hsn = None

    remaining = []

    token_index = 0
    while token_index < len(tokens):
        token = tokens[token_index]
        token = normalize_spaces(token)

        if not token:
            token_index += 1
            continue

        if is_size_value(token):
            size = token
            token_index += 1
            continue

        token_weight = extract_weight_value(token)
        if (
            not token_weight
            and token_index > 0
            and token.upper() in WEIGHT_UNITS
        ):
            token_weight = extract_weight_value(
                f"{tokens[token_index - 1]} {token}"
            )
        if token_weight:
            weight = token_weight
            token_index += 1
            continue

        if is_hsn_value(token):
            hsn = token
            token_index += 1
            continue

        if (
            product_code is None
            and looks_like_product_code(token)
        ):
            # Product code should normally contain digit.
            if re.search(
                r"\d",
                token,
            ):
                product_code = token
                token_index += 1
                continue

        remaining.append(token)
        token_index += 1

    return {
        "product_code": product_code,
        "size": size,
        "weight": weight,
        "hsn": hsn,
        "remaining": remaining,
    }


# ============================================================
# NUMERIC OCR HELPERS
# ============================================================

def is_numeric_ocr_line(line):
    """
    Detect a line containing only a numeric amount.
    """

    line = normalize_spaces(line)

    return bool(
        re.fullmatch(
            r"\d[\d,]*(?:\.\d+)?",
            line,
        )
    )


def choose_rate_and_amount(
    quantity,
    remaining,
):
    """
    Find rate + amount using:

        quantity * rate ~= amount

    Example:

        513
        1108.08
        325.50
        166982

    Correct:

        rate = 325.50
        amount = 166982
    """

    if not remaining:
        return None, None

    # --------------------------------------------------------
    # Strongest method:
    # quantity * rate ~= amount
    # --------------------------------------------------------

    for rate_index, rate_candidate in enumerate(
        remaining
    ):
        if rate_candidate <= 0:
            continue

        if rate_candidate > Decimal("100000"):
            continue

        calculated = quantity * rate_candidate

        for amount_candidate in remaining[
            rate_index + 1:
        ]:
            if amount_candidate <= 0:
                continue

            difference = abs(
                amount_candidate - calculated
            )

            if difference <= AMOUNT_TOLERANCE:
                return (
                    rate_candidate,
                    amount_candidate,
                )

    # --------------------------------------------------------
    # Fallback:
    # Decimal values are more likely to be rate.
    # --------------------------------------------------------

    decimal_candidates = [
        value
        for value in remaining
        if (
            value > 0
            and value < Decimal("100000")
            and value != value.to_integral_value()
        )
    ]

    if decimal_candidates:
        return (
            decimal_candidates[0],
            None,
        )

    # --------------------------------------------------------
    # Last fallback.
    # --------------------------------------------------------

    return (
        remaining[0],
        None,
    )


# ============================================================
# BUILD PRODUCT FROM OCR LINES
# ============================================================

def build_item_from_ocr_lines(
    lines,
    name_index,
):
    """
    Parse one product beginning from product name.

    Once the next real product name begins,
    current product parsing stops.

    Known metadata such as PRE is allowed inside
    the current product.
    """

    product_name = normalize_spaces(
        lines[name_index]
    )

    if not looks_like_product_name(
        product_name
    ):
        return None

    initial_metadata = extract_code_size_hsn_from_tokens(
        product_name.split()
    )
    size_match = SIZE_SEARCH_PATTERN.search(product_name)
    initial_size = (
        normalize_spaces(size_match.group(1))
        if size_match
        else initial_metadata["size"]
    )
    initial_weight = initial_metadata["weight"]
    if size_match:
        product_name = SIZE_SEARCH_PATTERN.sub(
            " ",
            product_name,
            count=1,
        )
    raw_name_tokens = product_name.split()
    name_tokens = []
    token_index = 0
    while token_index < len(raw_name_tokens):
        token = raw_name_tokens[token_index]
        if is_size_value(token) or extract_weight_value(token):
            token_index += 1
            continue
        if (
            token_index + 1 < len(raw_name_tokens)
            and raw_name_tokens[token_index + 1].upper() in WEIGHT_UNITS
            and extract_weight_value(
                f"{token} {raw_name_tokens[token_index + 1]}"
            )
        ):
            token_index += 2
            continue
        name_tokens.append(token)
        token_index += 1
    product_name = normalize_spaces(" ".join(name_tokens))

    metadata_tokens = []
    numeric_values = []

    end_index = min(
        len(lines),
        name_index + 20,
    )

    for index in range(
        name_index + 1,
        end_index,
    ):
        line = normalize_spaces(
            lines[index]
        )

        if not line:
            continue

        # ----------------------------------------------------
        # Summary starts.
        # ----------------------------------------------------

        if looks_like_summary_line(line):
            break

        if is_weight_value(line):
            metadata_tokens.append(line)
            continue

        labelled_weight = extract_weight_value(line)
        if (
            labelled_weight
            and re.match(r"^(?:NET\s+|GROSS\s+)?WEIGHT\b", line, re.IGNORECASE)
        ):
            metadata_tokens.append(labelled_weight)
            continue

        labelled_size = SIZE_SEARCH_PATTERN.search(line)
        if (
            labelled_size
            and re.match(r"^SIZE\b", line, re.IGNORECASE)
        ):
            metadata_tokens.append(labelled_size.group(1))
            continue

        # ----------------------------------------------------
        # Explicit charge / non-product line.
        # ----------------------------------------------------

        if is_non_product_line(line):
            # PRE is a grade/metadata value.
            if line.upper() == "PRE":
                metadata_tokens.append(line)

            # Other non-product lines indicate that the
            # product section is ending.
            continue

        # ----------------------------------------------------
        # A new product-like text line.
        # ----------------------------------------------------

        if looks_like_product_name(line):
            upper_line = line.upper()

            # Grade / unit metadata.
            if upper_line in {
                "PCS",
                "PC",
                "BOX",
                "NOS",
                "SQFT",
                "SQ FT",
                "KG",
                "KGS",
            }:
                metadata_tokens.append(line)
                continue

            if upper_line == "PRE":
                metadata_tokens.append(line)
                continue

            # Otherwise this is the next product.
            break

        # ----------------------------------------------------
        # Size.
        # ----------------------------------------------------

        if is_size_value(line):
            metadata_tokens.append(line)
            continue

        # ----------------------------------------------------
        # HSN.
        # ----------------------------------------------------

        if is_hsn_value(line):
            metadata_tokens.append(line)
            continue

        # ----------------------------------------------------
        # Numeric value.
        # ----------------------------------------------------

        if is_numeric_ocr_line(line):
            value = parse_decimal(
                line,
                default=None,
            )

            if value is not None:
                numeric_values.append(value)

            continue

        # ----------------------------------------------------
        # Other metadata.
        # ----------------------------------------------------

        metadata_tokens.append(line)

    # --------------------------------------------------------
    # Need numeric values.
    # --------------------------------------------------------

    if not numeric_values:
        return None

    # --------------------------------------------------------
    # Metadata.
    # --------------------------------------------------------

    metadata = extract_code_size_hsn_from_tokens(
        metadata_tokens
    )

    product_code = metadata["product_code"]
    size = metadata["size"] or initial_size
    weight = metadata["weight"] or initial_weight
    hsn = metadata["hsn"]

    # --------------------------------------------------------
    # Quantity.
    #
    # Usually first positive integer after product name.
    # --------------------------------------------------------

    quantity = None
    quantity_index = None

    for index, value in enumerate(
        numeric_values[:5]
    ):
        if (
            value > 0
            and value == value.to_integral_value()
        ):
            quantity = value
            quantity_index = index
            break

    if quantity is None:
        quantity = numeric_values[0]
        quantity_index = 0

    if quantity <= 0:
        return None

    # --------------------------------------------------------
    # Remaining numeric values.
    # --------------------------------------------------------

    remaining = numeric_values[
        quantity_index + 1:
    ]

    if not remaining:
        return None

    # --------------------------------------------------------
    # Rate + amount.
    # --------------------------------------------------------

    purchase_price, line_total = (
        choose_rate_and_amount(
            quantity,
            remaining,
        )
    )

    if purchase_price is None:
        return None

    if purchase_price < 0:
        purchase_price = Decimal("0")

    return {
        "product_code": product_code,
        "name": product_name,
        "product_name": product_name,
        "size": size,
        "weight": weight,
        "hsn": hsn,
        "quantity": quantity,
        "purchase_price": purchase_price,
        "rate": purchase_price,
        "line_total": line_total,
    }


# ============================================================
# PRODUCT ROW PARSER
# ============================================================

def parse_product_rows(lines):
    """
    Parse products from OCR lines.

    Different products remain separate.

    Example:

        GLAZE VITRIFIED TILES - 2 PC
        GLAZE VITRIFIED TILES - 3 PC

    remain two products.
    """

    items = []
    used_name_indexes = set()

    for index, line in enumerate(lines):
        line = normalize_spaces(line)

        if not looks_like_product_name(line):
            continue

        # ----------------------------------------------------
        # Skip explicit non-product lines.
        # ----------------------------------------------------

        if is_non_product_line(line):
            continue

        # ----------------------------------------------------
        # Skip exact duplicate OCR line.
        # ----------------------------------------------------

        if index > 0:
            previous = normalize_product_name(
                lines[index - 1]
            )

            current = normalize_product_name(
                line
            )

            if previous == current:
                continue

        if index in used_name_indexes:
            continue

        # ----------------------------------------------------
        # Document metadata should never be products.
        # ----------------------------------------------------

        lower_line = line.lower()

        blocked_words = [
            "gstin",
            "invoice number",
            "invoice date",
            "tax invoice",
            "grand total",
            "total tax",
            "address",
            "phone",
            "mobile",
            "email",
            "date of invoice",
            "supplier",
            "seller",
            "vendor",
            "buyer",
            "consignee",
            "bill to",
            "ship to",
            "freight",
            "insurance",
            "discount",
            "integrated tax",
            "integrated ta",
        ]

        if any(
            word in lower_line
            for word in blocked_words
        ):
            continue

        item = build_item_from_ocr_lines(
            lines,
            index,
        )

        if item is None:
            continue

        items.append(item)

        used_name_indexes.add(index)

    return items


# ============================================================
# TABLE-LIKE ROW PARSER
# ============================================================

def parse_table_like_rows(raw_lines):
    """
    Handles cases where complete product row
    comes in one OCR line.

    Example:

        GLAZE VITRIFIED TILES - 2 PC PRE 600X1200 20 217 4340
    """

    items = []

    for raw_line in raw_lines:
        line = normalize_spaces(
            raw_line
        )

        if not line:
            continue

        if looks_like_summary_line(line):
            continue

        if is_non_product_line(line):
            continue

        numbers = re.findall(
            r"\d[\d,]*(?:\.\d+)?",
            line,
        )

        if len(numbers) < 2:
            continue

        # Skip numeric-only lines.
        if re.fullmatch(
            r"[\d,\s.]+",
            line,
        ):
            continue

        tokens = line.split()

        text_tokens = []
        numeric_tokens = []
        detected_size = None
        detected_weight = None
        detected_hsn = None
        detected_code = None

        token_index = 0
        while token_index < len(tokens):
            token = tokens[token_index]

            # Product descriptions can end in variants such as
            # "2 PC" or "3 PCS". Keep these together as name text,
            # rather than treating the number as the row quantity.
            pc_count = re.fullmatch(
                r"(\d+(?:[.,]\d+)?)\s*(PCS?)",
                token,
                re.IGNORECASE,
            )
            if not pc_count and token_index + 1 < len(tokens):
                if re.fullmatch(r"\d+(?:[.,]\d+)?", token) and re.fullmatch(
                    r"PCS?",
                    tokens[token_index + 1],
                    re.IGNORECASE,
                ):
                    pc_count = re.fullmatch(
                        r"(\d+(?:[.,]\d+)?)\s*(PCS?)",
                        f"{token} {tokens[token_index + 1]}",
                        re.IGNORECASE,
                    )
                    if pc_count:
                        text_tokens.append(
                            f"{pc_count.group(1)} {pc_count.group(2).upper()}"
                        )
                        token_index += 2
                        continue

            if pc_count:
                text_tokens.append(
                    f"{pc_count.group(1)} {pc_count.group(2).upper()}"
                )
                token_index += 1
                continue

            token_size, size_token_count = find_size_tokens(
                tokens,
                token_index,
            )
            if token_size:
                detected_size = token_size
                token_index += size_token_count
                continue

            token_weight = extract_weight_value(token)
            if (
                not token_weight
                and token_index + 1 < len(tokens)
                and tokens[token_index + 1].upper() in WEIGHT_UNITS
            ):
                token_weight = extract_weight_value(
                    f"{token} {tokens[token_index + 1]}"
                )
                if token_weight:
                    token_index += 1

            if token_weight:
                detected_weight = token_weight
                token_index += 1
                continue

            if is_size_value(token):
                detected_size = token
                token_index += 1
                continue

            if is_hsn_value(token):
                detected_hsn = token
                token_index += 1
                continue

            if re.fullmatch(
                r"\d[\d,]*(?:\.\d+)?",
                token,
            ):
                numeric_tokens.append(token)
            else:
                text_tokens.append(token)
            token_index += 1

        if not text_tokens:
            continue

        filtered_name = []

        for token in text_tokens:
            if re.fullmatch(
                r"\d+(?:[.,]\d+)?\s*PCS?",
                token,
                re.IGNORECASE,
            ):
                filtered_name.append(
                    normalize_spaces(token).upper()
                )
                continue

            if is_size_value(token):
                detected_size = token
                continue

            token_weight = extract_weight_value(token)
            if token_weight:
                detected_weight = token_weight
                continue

            if is_hsn_value(token):
                detected_hsn = token
                continue

            if token.upper() == "PRE":
                continue

            if (
                detected_code is None
                and looks_like_product_code(token)
                and re.search(
                    r"\d",
                    token,
                )
            ):
                detected_code = token
                continue

            filtered_name.append(token)

        product_name = normalize_spaces(
            " ".join(filtered_name)
        )

        if not product_name:
            continue

        if not looks_like_product_name(
            product_name
        ):
            continue

        values = [
            parse_decimal(
                value,
                default=None,
            )
            for value in numeric_tokens
        ]

        values = [
            value
            for value in values
            if value is not None
        ]

        if len(values) < 2:
            continue

        # ----------------------------------------------------
        # Quantity.
        # ----------------------------------------------------

        quantity = None
        quantity_index = None

        for index, value in enumerate(
            values[:5]
        ):
            if (
                value > 0
                and value == value.to_integral_value()
            ):
                quantity = value
                quantity_index = index
                break

        if quantity is None:
            continue

        remaining = values[
            quantity_index + 1:
        ]

        if not remaining:
            continue

        purchase_price, line_total = (
            choose_rate_and_amount(
                quantity,
                remaining,
            )
        )

        if purchase_price is None:
            continue

        items.append(
            {
                "product_code": detected_code,
                "name": product_name,
                "product_name": product_name,
                "size": detected_size,
                "weight": detected_weight,
                "hsn": detected_hsn,
                "quantity": quantity,
                "purchase_price": purchase_price,
                "rate": purchase_price,
                "line_total": line_total,
            }
        )

    return items


# ============================================================
# ITEM CLEANUP
# ============================================================

def merge_duplicate_ocr_items(items):
    """
    Merge ONLY exact duplicate OCR occurrences.

    Different product names stay separate.
    """

    result = []
    seen = set()

    for item in items:
        name_key = normalize_product_name(
            item.get("name")
            or item.get("product_name")
            or ""
        )

        quantity = item.get(
            "quantity"
        )

        purchase_price = item.get(
            "purchase_price"
        )

        key = (
            name_key,
            str(quantity),
            str(purchase_price),
            item.get("size") or "",
            item.get("weight") or "",
        )

        if key in seen:
            continue

        seen.add(key)

        result.append(item)

    return result


def clean_items(items):
    cleaned = []

    for item in items:
        name = normalize_spaces(
            item.get("name")
            or item.get("product_name")
            or ""
        )

        if not name:
            continue

        # Never allow known non-product rows through.
        if is_non_product_line(name):
            continue

        quantity = parse_decimal(
            item.get("quantity"),
            default=None,
        )

        purchase_price = parse_decimal(
            item.get("purchase_price")
            if item.get("purchase_price") is not None
            else item.get("rate"),
            default=None,
        )

        if quantity is None:
            continue

        if quantity <= 0:
            continue

        if purchase_price is None:
            purchase_price = Decimal("0")

        # ----------------------------------------------------
        # Product code.
        # ----------------------------------------------------

        product_code = item.get(
            "product_code"
        )

        if product_code:
            product_code = clean_text(
                product_code
            )

            if (
                is_size_value(product_code)
                or is_hsn_value(product_code)
            ):
                product_code = None

            elif not looks_like_product_code(
                product_code
            ):
                product_code = None

        # ----------------------------------------------------
        # Size.
        # ----------------------------------------------------

        size = item.get(
            "size"
        )

        if size:
            size = normalize_spaces(size)

            if not is_size_value(size):
                size = None

        weight = item.get("weight")
        if weight:
            weight = extract_weight_value(weight)

        # ----------------------------------------------------
        # HSN.
        # ----------------------------------------------------

        hsn = item.get(
            "hsn"
        )

        if hsn:
            hsn = clean_text(hsn)

            if not is_hsn_value(hsn):
                hsn = None

        # ----------------------------------------------------
        # Line total.
        # ----------------------------------------------------

        line_total = parse_decimal(
            item.get("line_total"),
            default=None,
        )

        # ----------------------------------------------------
        # If OCR gave a line total but it is slightly wrong,
        # keep OCR value.
        #
        # If missing, calculate it from quantity * rate.
        # ----------------------------------------------------

        if line_total is None:
            line_total = (
                quantity * purchase_price
            )

        cleaned.append(
            {
                "product_code": product_code,
                "name": name,
                "product_name": name,
                "size": size,
                "weight": weight,
                "hsn": hsn,
                "quantity": quantity,
                "purchase_price": purchase_price,
                "rate": purchase_price,
                "line_total": line_total,
            }
        )

    return merge_duplicate_ocr_items(
        cleaned
    )


# ============================================================
# FULL BILL PARSER
# ============================================================

def parse_bill_text(raw_lines):
    """
    Convert OCR/native PDF text into structure
    expected by Django PurchaseDraft upload endpoint.
    """

    lines = [
        normalize_spaces(line)
        for line in raw_lines
        if normalize_spaces(line)
    ]

    full_text = "\n".join(lines)

    # --------------------------------------------------------
    # Header / bill information.
    # --------------------------------------------------------

    supplier = extract_supplier(
        lines
    )
    supplier_gstin = extract_supplier_gstin(
        lines
    )
    supplier_phone = extract_supplier_phone(
        lines
    )
    bill_number = extract_invoice_number(
        lines,
        full_text,
    )

    bill_date = extract_invoice_date(
        lines,
        full_text,
    )

    # --------------------------------------------------------
    # Financial information.
    # --------------------------------------------------------

    tax = extract_tax(
        lines
    )

    grand_total = extract_grand_total(
        lines
    )

    # --------------------------------------------------------
    # Primary product parser.
    # --------------------------------------------------------

    items = parse_product_rows(
        lines
    )

    # --------------------------------------------------------
    # Fallback table parser.
    # --------------------------------------------------------

    if not items:
        items = parse_table_like_rows(
            lines
        )

    items = clean_items(
        items
    )

    return {
        "supplier": supplier,
        "supplier_name": supplier,
        "supplier_gstin": supplier_gstin,
        "supplier_phone": supplier_phone,

        "bill_number": bill_number,
        "invoice_number": bill_number,

        "bill_date": (
            bill_date.isoformat()
            if bill_date
            else None
        ),

        "invoice_date": (
            bill_date.isoformat()
            if bill_date
            else None
        ),

        "tax": tax,
        "grand_total": grand_total,

        "items": items,

        "raw_text": full_text,
    }


# ============================================================
# PDF OCR
# ============================================================

def ocr_pdf(
    pdf_path,
    work_dir=None,
):
    """
    Main PDF OCR function.

    Strategy:

    1. Try native PDF text extraction.
    2. If enough useful product data is found,
       return native result.
    3. Otherwise render pages and run PaddleOCR.
    """

    pdf_path = Path(
        pdf_path
    )

    if not pdf_path.exists():
        raise FileNotFoundError(
            f"Bill PDF not found: {pdf_path}"
        )

    # ========================================================
    # STEP 1: NATIVE PDF TEXT
    # ========================================================

    native_lines, native_page_count = (
        get_pdf_native_text(
            pdf_path
        )
    )

    native_text = "\n".join(
        native_lines
    )

    native_char_count = len(
        native_text.replace(
            "--- PAGE",
            "",
        ).strip()
    )

    if native_char_count >= NATIVE_TEXT_MIN_CHARS:
        native_result = parse_bill_text(
            native_lines
        )

        # If native parser found products,
        # no OCR is necessary.
        if native_result.get("items"):
            native_result[
                "ocr_line_count"
            ] = len(native_lines)

            native_result[
                "pages"
            ] = native_page_count

            native_result[
                "ocr_method"
            ] = "native_pdf_text"

            native_result[
                "ocr_skipped"
            ] = True

            return native_result

    # ========================================================
    # STEP 2: PADDLEOCR FALLBACK
    # ========================================================

    if work_dir is None:
        work_dir = (
            pdf_path.parent
            / f"{pdf_path.stem}_ocr"
        )

    work_dir = Path(
        work_dir
    )

    work_dir.mkdir(
        parents=True,
        exist_ok=True,
    )

    page_paths = render_pdf_to_images(
        pdf_path,
        output_dir=work_dir,
        zoom=PDF_ZOOM,
    )

    all_lines = []

    for page_number, page_path in enumerate(
        page_paths,
        start=1,
    ):
        page_lines = run_paddle_ocr_on_image(
            page_path
        )

        all_lines.extend(
            page_lines
        )

        all_lines.append(
            f"--- PAGE {page_number} END ---"
        )

    result = parse_bill_text(
        all_lines
    )

    result[
        "ocr_line_count"
    ] = len(all_lines)

    result[
        "pages"
    ] = len(page_paths)

    result[
        "ocr_method"
    ] = "paddleocr"

    result[
        "ocr_skipped"
    ] = False

    return result


# ============================================================
# IMAGE OCR
# ============================================================

def ocr_image(image_path):
    """
    OCR JPG/PNG/WEBP directly.
    """

    image_path = Path(
        image_path
    )

    if not image_path.exists():
        raise FileNotFoundError(
            f"Image file not found: {image_path}"
        )

    lines = run_paddle_ocr_on_image(
        image_path
    )

    result = parse_bill_text(
        lines
    )

    result[
        "ocr_line_count"
    ] = len(lines)

    result[
        "pages"
    ] = 1

    result[
        "ocr_method"
    ] = "paddleocr"

    result[
        "ocr_skipped"
    ] = False

    return result


# ============================================================
# GENERIC ENTRY POINT
# ============================================================

def extract_bill_data(file_path):
    """
    Generic OCR entry point.

    Supports:

        PDF
        JPG
        JPEG
        PNG
        WEBP
    """

    file_path = Path(
        file_path
    )

    if not file_path.exists():
        raise FileNotFoundError(
            f"File not found: {file_path}"
        )

    extension = file_path.suffix.lower()

    if extension == ".pdf":
        return ocr_pdf(
            file_path
        )

    if extension in [
        ".jpg",
        ".jpeg",
        ".png",
        ".webp",
    ]:
        return ocr_image(
            file_path
        )

    raise ValueError(
        "Unsupported bill file format. "
        "Please upload PDF, JPG, JPEG, PNG or WEBP."
    )


# ============================================================
# MAIN FUNCTION USED BY VIEWS.PY
# ============================================================

def extract_purchase_bill(file_path):
    """
    Main function imported by Django views.py.

    views.py:

        from .services.ocr_service import extract_purchase_bill
    """

    return extract_bill_data(
        file_path
    )


# ============================================================
# COMPATIBILITY ALIASES
# ============================================================

extract_invoice_data = extract_bill_data
process_bill = extract_bill_data
read_bill = extract_bill_data
ocr_bill = extract_bill_data