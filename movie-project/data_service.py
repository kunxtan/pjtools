"""Data layer for CineScope.

Everything that touches the Excel file lives here:
- first-run conversion from data/movies.csv to data/movies.xlsx
- data cleaning (rating merge, splitting the "released" column)
- reading the workbook (with a small cache keyed on file modification time)
- safe writing (write to a temp file, then replace the original)
- add / update / delete a movie, and server-side form validation

Statistics and models are NOT here; they belong in analysis.py.
"""

import os
from datetime import date

import pandas as pd

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
CSV_PATH = os.path.join(DATA_DIR, "movies.csv")
XLSX_PATH = os.path.join(DATA_DIR, "movies.xlsx")
TEMP_PATH = os.path.join(DATA_DIR, "movies.tmp.xlsx")
SHEET_NAME = "movies"

# Column order stored in the Excel file.
COLUMNS = [
    "id", "name", "rating", "genre", "year", "release_date", "release_country",
    "score", "votes", "director", "writer", "star", "country",
    "budget", "gross", "company", "runtime",
]
TEXT_COLUMNS = [
    "name", "rating", "genre", "release_date", "release_country",
    "director", "writer", "star", "country", "company",
]
NUMBER_COLUMNS = ["year", "score", "votes", "budget", "gross", "runtime"]

# Ratings that mean the same thing are merged into one label.
RATING_ALIASES = {"Unrated": "Not Rated"}


class ExcelLockedError(Exception):
    """Raised when the Excel file cannot be written (usually open in Excel)."""

    def __init__(self):
        super().__init__(
            "บันทึกข้อมูลไม่สำเร็จ เนื่องจากไฟล์ data/movies.xlsx ถูกเปิดค้างอยู่ "
            "(เช่น เปิดในโปรแกรม Excel) กรุณาปิดไฟล์แล้วลองใหม่อีกครั้ง"
        )


class MovieNotFoundError(Exception):
    """Raised when a movie id does not exist."""

    def __init__(self, movie_id):
        super().__init__(f"ไม่พบภาพยนตร์รหัส {movie_id}")


# ---------------------------------------------------------------------------
# Cleaning
# ---------------------------------------------------------------------------

def normalize_rating(value):
    """Merge duplicate rating labels, e.g. "Unrated" -> "Not Rated"."""
    if pd.isna(value):
        return value
    value = str(value).strip()
    return RATING_ALIASES.get(value, value)


def split_released(released):
    """Split "June 13, 1980 (United States)" into ("1980-06-13", "United States").

    Full dates become ISO format (YYYY-MM-DD). Partial dates such as
    "November 1980" are kept as written so no information is invented.
    """
    released = released.fillna("").astype(str)
    parts = released.str.extract(r"^(.*?)\s*\((.*)\)\s*$")
    date_text = parts[0].fillna(released).str.strip()
    country = parts[1].str.strip()

    parsed = pd.to_datetime(date_text, format="%B %d, %Y", errors="coerce")
    release_date = parsed.dt.strftime("%Y-%m-%d").where(parsed.notna(), date_text)
    release_date = release_date.replace("", pd.NA)
    return release_date, country


def clean_raw_csv(raw):
    """Turn the original CSV table into the table stored in Excel."""
    df = raw.copy()
    df["rating"] = df["rating"].map(normalize_rating)
    df["release_date"], df["release_country"] = split_released(df["released"])
    df = df.drop(columns=["released"])
    df.insert(0, "id", range(1, len(df) + 1))
    return df[COLUMNS]


def add_financials(df):
    """Add profit and roi columns.

    Only rows with both budget and gross (and budget > 0) get values;
    the rest stay empty so financial analysis can simply drop them.
    """
    has_money = df["budget"].notna() & df["gross"].notna() & (df["budget"] > 0)
    df["profit"] = (df["gross"] - df["budget"]).where(has_money)
    df["roi"] = (df["gross"] / df["budget"]).where(has_money)
    return df


def prepare_loaded(df):
    """Fix types and derived columns after reading the workbook."""
    for col in COLUMNS:
        if col not in df.columns:
            df[col] = pd.NA
    df = df[COLUMNS].copy()

    df["id"] = pd.to_numeric(df["id"], errors="coerce").astype("Int64")
    for col in NUMBER_COLUMNS:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    for col in TEXT_COLUMNS:
        df[col] = df[col].astype("string").str.strip().replace("", pd.NA)

    df["rating"] = df["rating"].map(normalize_rating).astype("string")
    df = df[df["id"].notna()]
    return add_financials(df)


# ---------------------------------------------------------------------------
# Reading / writing Excel
# ---------------------------------------------------------------------------

_cache = {"mtime": None, "df": None}


def ensure_excel():
    """Create data/movies.xlsx from data/movies.csv on first run."""
    if os.path.exists(XLSX_PATH):
        return False
    if not os.path.exists(CSV_PATH):
        raise FileNotFoundError(
            f"ไม่พบไฟล์ข้อมูล {CSV_PATH} กรุณาวาง movies.csv ไว้ในโฟลเดอร์ data/"
        )
    raw = pd.read_csv(CSV_PATH)
    write_excel(clean_raw_csv(raw))
    return True


def read_excel():
    """Read the workbook from disk (no cache, no derived columns)."""
    return pd.read_excel(XLSX_PATH, sheet_name=SHEET_NAME, engine="openpyxl")


def write_excel(df):
    """Write the movie table safely.

    The data is written to a temporary file first and then moved over the
    real file, so a crash mid-write never leaves a half-written workbook.
    """
    table = df[COLUMNS]
    try:
        table.to_excel(TEMP_PATH, sheet_name=SHEET_NAME, index=False, engine="openpyxl")
        os.replace(TEMP_PATH, XLSX_PATH)
    except PermissionError as exc:
        _remove_temp_file()
        raise ExcelLockedError() from exc
    except Exception:
        _remove_temp_file()
        raise
    _cache["mtime"] = None  # force a fresh read next time


def _remove_temp_file():
    try:
        if os.path.exists(TEMP_PATH):
            os.remove(TEMP_PATH)
    except OSError:
        pass


def data_version():
    """A value that changes whenever the Excel file changes (for model caching)."""
    ensure_excel()
    return os.path.getmtime(XLSX_PATH)


def load_movies():
    """Return the cleaned movie table, including profit and roi.

    The workbook is re-read only when its modification time changes, so pages
    always reflect the current file without re-parsing it on every request.
    A copy is returned so callers cannot modify the cache.
    """
    mtime = data_version()
    if _cache["df"] is None or _cache["mtime"] != mtime:
        _cache["df"] = prepare_loaded(read_excel())
        _cache["mtime"] = mtime
    return _cache["df"].copy()


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

def get_movie(movie_id):
    """Return one movie as a dict (missing values become None)."""
    df = load_movies()
    row = df[df["id"] == int(movie_id)]
    if row.empty:
        raise MovieNotFoundError(movie_id)
    record = row.iloc[0].to_dict()
    return {key: (None if pd.isna(value) else value) for key, value in record.items()}


def add_movie(record):
    """Append a validated record and return its new id."""
    df = load_movies()
    new_id = int(df["id"].max()) + 1 if len(df) else 1
    new_row = {col: record.get(col) for col in COLUMNS}
    new_row["id"] = new_id
    df = pd.concat([df[COLUMNS], pd.DataFrame([new_row])], ignore_index=True)
    write_excel(df)
    return new_id


def update_movie(movie_id, record):
    """Overwrite the fields of an existing movie with a validated record."""
    df = load_movies()[COLUMNS]
    mask = df["id"] == int(movie_id)
    if not mask.any():
        raise MovieNotFoundError(movie_id)
    for col in COLUMNS:
        if col != "id":
            df.loc[mask, col] = record.get(col)
    write_excel(df)


def delete_movie(movie_id):
    """Remove a movie by id."""
    df = load_movies()[COLUMNS]
    mask = df["id"] == int(movie_id)
    if not mask.any():
        raise MovieNotFoundError(movie_id)
    write_excel(df[~mask])


def get_choices(df=None):
    """Distinct genre, rating and country values for form dropdowns."""
    if df is None:
        df = load_movies()

    def distinct(col):
        return sorted(df[col].dropna().astype(str).unique().tolist())

    return {
        "genre": distinct("genre"),
        "rating": distinct("rating"),
        "country": distinct("country"),
    }


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

def _parse_number(form, field, errors, label, minimum=None, maximum=None,
                  integer=False, required=False):
    text = str(form.get(field, "") or "").strip().replace(",", "")
    if text == "":
        if required:
            errors[field] = f"กรุณากรอก{label}"
        return None
    try:
        value = float(text)
    except ValueError:
        errors[field] = f"{label}ต้องเป็นตัวเลข"
        return None
    if integer and not value.is_integer():
        errors[field] = f"{label}ต้องเป็นจำนวนเต็ม"
        return None
    if minimum is not None and value < minimum:
        errors[field] = _range_message(label, minimum, maximum)
        return None
    if maximum is not None and value > maximum:
        errors[field] = _range_message(label, minimum, maximum)
        return None
    return int(value) if integer else value


def _range_message(label, minimum, maximum):
    if maximum is None:
        return f"{label}ต้องไม่ติดลบ" if minimum == 0 else f"{label}ต้องไม่น้อยกว่า {minimum:g}"
    return f"{label}ต้องอยู่ระหว่าง {minimum:g} ถึง {maximum:g}"


def validate_movie(form):
    """Validate submitted form data.

    Returns (record, errors). `record` holds cleaned values ready to save;
    `errors` maps field name -> Thai error message (empty when valid).
    """
    errors = {}
    record = {}

    for field in TEXT_COLUMNS:
        text = str(form.get(field, "") or "").strip()
        record[field] = text or None

    if not record["name"]:
        errors["name"] = "กรุณากรอกชื่อเรื่อง"
    if not record["genre"]:
        errors["genre"] = "กรุณาเลือกประเภทหนัง"
    record["rating"] = normalize_rating(record["rating"]) if record["rating"] else None

    if record["release_date"] and len(record["release_date"]) == 10:
        try:
            date.fromisoformat(record["release_date"])
        except ValueError:
            errors["release_date"] = "รูปแบบวันฉายไม่ถูกต้อง (ใช้ ปี-เดือน-วัน เช่น 1980-06-13)"

    current_year = date.today().year
    record["year"] = _parse_number(form, "year", errors, "ปีที่ฉาย",
                                   1900, current_year, integer=True, required=True)
    record["score"] = _parse_number(form, "score", errors, "คะแนน", 0, 10)
    record["votes"] = _parse_number(form, "votes", errors, "จำนวนโหวต", 0, integer=True)
    record["budget"] = _parse_number(form, "budget", errors, "ทุนสร้าง", 0)
    record["gross"] = _parse_number(form, "gross", errors, "รายได้", 0)
    record["runtime"] = _parse_number(form, "runtime", errors, "ความยาว", 1, 600)

    return record, errors
