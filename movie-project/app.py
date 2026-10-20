"""CineScope - Flask entry point (routes only).

Run with:
    pip install -r requirements.txt
    python app.py
"""

import math
from datetime import date

from flask import (Flask, flash, jsonify, redirect, render_template, request,
                   url_for)

import data_service

# ---------------------------------------------------------------------------
# Project settings - edit these values for your group
# ---------------------------------------------------------------------------

SITE_NAME = "CineScope"
SITE_TAGLINE = "ทุกความสำเร็จของหนัง มีตัวเลขเล่าเรื่อง"

GROUP_NAME = "ชื่อกลุ่ม"
MEMBERS = [
    "สมาชิกคนที่ 1",
    "สมาชิกคนที่ 2",
    "สมาชิกคนที่ 3",
    "สมาชิกคนที่ 4",
    "สมาชิกคนที่ 5",
]
DATA_SOURCE = "Movie Industry dataset (movies.csv) - 7,668 movies, 1980-2020"

# Paste your Tableau Public share link here. Leave empty to show setup instructions.
TABLEAU_URL = ""

# One color per genre, shared by every page and every chart.
GENRE_COLORS = {
    "Comedy": "#f5c518",
    "Action": "#ef4444",
    "Drama": "#a78bfa",
    "Crime": "#94a3b8",
    "Biography": "#f97316",
    "Adventure": "#22c55e",
    "Animation": "#60a5fa",
    "Horror": "#a3e635",
    "Fantasy": "#e879f9",
    "Mystery": "#818cf8",
    "Thriller": "#fb7185",
    "Family": "#2dd4bf",
    "Sci-Fi": "#22d3ee",
    "Romance": "#f472b6",
    "Western": "#d4a373",
    "Musical": "#fda4af",
    "Music": "#f0abfc",
    "History": "#d6d3d1",
    "Sport": "#4ade80",
}
DEFAULT_GENRE_COLOR = "#cbd5e1"

# Navbar entries: (endpoint, label, emoji). Entries whose page does not exist
# yet are skipped automatically, so the navbar never shows a broken link.
NAV_ITEMS = [
    ("home", "หน้าแรก", "🏠"),
    ("movies", "รายการหนัง", "🎞️"),
    ("analysis", "วิเคราะห์ข้อมูล", "📊"),
    ("simulator", "Box Office Simulator", "🎬"),
    ("dashboard", "Dashboard", "🗺️"),
]

PER_PAGE = 20

app = Flask(__name__)
app.config["SECRET_KEY"] = "cinescope-data-tools-project"
app.json.ensure_ascii = False


# ---------------------------------------------------------------------------
# Template helpers
# ---------------------------------------------------------------------------

def is_missing(value):
    return value is None or (isinstance(value, float) and math.isnan(value))


@app.template_filter("money")
def format_money(value):
    """$1.2B / $1.2M / $350K / $950, or an em dash when missing."""
    if is_missing(value):
        return "—"
    sign = "-" if value < 0 else ""
    amount = abs(float(value))
    if amount >= 1e9:
        text = f"{amount / 1e9:.1f}B"
    elif amount >= 1e6:
        text = f"{amount / 1e6:.1f}M"
    elif amount >= 1e3:
        text = f"{amount / 1e3:.0f}K"
    else:
        text = f"{amount:.0f}"
    return f"{sign}${text}"


@app.template_filter("number")
def format_number(value, decimals=0):
    """Thousands separators, or an em dash when missing."""
    if is_missing(value):
        return "—"
    return f"{float(value):,.{decimals}f}"


@app.template_filter("text")
def format_text(value):
    return "—" if is_missing(value) or value == "" else value


def genre_color(genre):
    return GENRE_COLORS.get(genre, DEFAULT_GENRE_COLOR)


def nav_items():
    """Navbar links for pages that exist, with the current page marked."""
    endpoint = request.endpoint or ""
    current = "movies" if endpoint.startswith("movie") else endpoint
    return [
        {"url": url_for(name), "label": label, "icon": icon, "active": name == current}
        for name, label, icon in NAV_ITEMS
        if name in app.view_functions
    ]


@app.context_processor
def inject_site_info():
    """Make site and group info available in every template."""
    return {
        "site_name": SITE_NAME,
        "site_tagline": SITE_TAGLINE,
        "group_name": GROUP_NAME,
        "members": MEMBERS,
        "data_source": DATA_SOURCE,
        "tableau_url": TABLEAU_URL,
        "genre_colors": GENRE_COLORS,
        "genre_color": genre_color,
        "nav_items": nav_items,
        "current_year": date.today().year,
    }


# ---------------------------------------------------------------------------
# Request helpers
# ---------------------------------------------------------------------------

def parse_int(value):
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        return None


def safe_next(target, fallback):
    """Only allow redirects to paths on this site (prevents open redirects)."""
    if target and target.startswith("/") and not target.startswith("//"):
        return target
    return fallback


def current_path():
    """Current path + query string, used as the 'next' link back to a list view."""
    return request.full_path.rstrip("?")


def to_form_values(movie):
    """Convert a stored movie into strings for the form inputs."""
    values = {}
    for col in data_service.COLUMNS:
        value = movie.get(col)
        if is_missing(value):
            values[col] = ""
        elif isinstance(value, float) and value.is_integer():
            values[col] = str(int(value))
        else:
            values[col] = str(value)
    return values


@app.errorhandler(data_service.MovieNotFoundError)
def handle_movie_not_found(error):
    flash(str(error), "error")
    return redirect(url_for("movies"))


@app.errorhandler(data_service.ExcelLockedError)
def handle_excel_locked(error):
    flash(str(error), "error")
    return redirect(url_for("movies"))


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def root():
    """Start page: the home page if it exists, otherwise the movie list."""
    target = "home" if "home" in app.view_functions else "movies"
    return redirect(url_for(target))


@app.route("/movies")
def movies():
    """Movie list with search, filters, sorting and pagination (all in the URL)."""
    df = data_service.load_movies()
    choices = data_service.get_choices(df)

    filters = {
        "q": request.args.get("q", "").strip(),
        "genre": request.args.get("genre", ""),
        "rating": request.args.get("rating", ""),
        "year_min": parse_int(request.args.get("year_min")),
        "year_max": parse_int(request.args.get("year_max")),
        "sort": request.args.get("sort", "year"),
        "order": "asc" if request.args.get("order") == "asc" else "desc",
    }
    if filters["sort"] not in data_service.SORTABLE_COLUMNS:
        filters["sort"] = "year"

    result = data_service.search_movies(
        df, page=parse_int(request.args.get("page")) or 1, per_page=PER_PAGE, **filters
    )

    def page_url(**changes):
        """URL of the list with the current filters plus `changes`."""
        args = {key: value for key, value in filters.items() if value not in (None, "")}
        args.update(changes)
        args = {key: value for key, value in args.items() if value not in (None, "")}
        return url_for("movies", **args)

    return render_template(
        "movies.html",
        filters=filters,
        result=result,
        choices=choices,
        year_bounds=(int(df["year"].min()), int(df["year"].max())),
        page_url=page_url,
        per_page=PER_PAGE,
        next_url=current_path(),
        has_filters=any(request.args.get(key) for key in
                        ("q", "genre", "rating", "year_min", "year_max")),
    )


@app.route("/movies/new", methods=["GET", "POST"])
def movie_new():
    return movie_form()


@app.route("/movies/<int:movie_id>/edit", methods=["GET", "POST"])
def movie_edit(movie_id):
    return movie_form(movie_id)


def movie_form(movie_id=None):
    """Shared add/edit form: validate, write to Excel, then redirect."""
    is_edit = movie_id is not None
    next_url = safe_next(request.values.get("next"), url_for("movies"))
    errors = {}
    status = 200

    if request.method == "POST":
        values = request.form.to_dict()
        record, errors = data_service.validate_movie(values)
        if errors:
            status = 400
        else:
            try:
                if is_edit:
                    data_service.update_movie(movie_id, record)
                    flash(f'แก้ไขข้อมูล "{record["name"]}" ลงไฟล์ Excel เรียบร้อยแล้ว', "success")
                    return redirect(next_url)
                new_id = data_service.add_movie(record)
                flash(f'เพิ่ม "{record["name"]}" (รหัส {new_id}) ลงไฟล์ Excel เรียบร้อยแล้ว', "success")
                return redirect(url_for("movies", q=record["name"]))
            except data_service.ExcelLockedError as error:
                # Keep the user's input on screen so nothing is lost.
                flash(str(error), "error")
                status = 423
    else:
        values = to_form_values(data_service.get_movie(movie_id)) if is_edit else {}

    return render_template(
        "form.html",
        is_edit=is_edit,
        movie_id=movie_id,
        values=values,
        errors=errors,
        choices=data_service.get_choices(),
        next_url=next_url,
    ), status


@app.route("/movies/<int:movie_id>/delete", methods=["POST"])
def movie_delete(movie_id):
    next_url = safe_next(request.form.get("next"), url_for("movies"))
    movie = data_service.get_movie(movie_id)
    try:
        data_service.delete_movie(movie_id)
        flash(f'ลบ "{movie["name"]}" ออกจากไฟล์ Excel เรียบร้อยแล้ว', "success")
    except data_service.ExcelLockedError as error:
        flash(str(error), "error")
    return redirect(next_url)


@app.route("/api/status")
def api_status():
    """Data status check: confirms the Excel file loads and is cleaned."""
    df = data_service.load_movies()
    return jsonify({
        "site": SITE_NAME,
        "excel_file": data_service.XLSX_PATH,
        "movies": int(len(df)),
        "year_range": [int(df["year"].min()), int(df["year"].max())],
        "rows_missing_budget": int(df["budget"].isna().sum()),
        "rows_with_budget_and_gross": int(df["profit"].notna().sum()),
        "ratings": df["rating"].value_counts().to_dict(),
    })


if __name__ == "__main__":
    if data_service.ensure_excel():
        print("Created data/movies.xlsx from data/movies.csv")
    app.run(debug=True)
