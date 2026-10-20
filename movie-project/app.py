"""CineScope - Flask entry point (routes only).

Run with:
    pip install -r requirements.txt
    python app.py
"""

from flask import Flask, jsonify

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

app = Flask(__name__)
app.config["SECRET_KEY"] = "cinescope-data-tools-project"
app.json.ensure_ascii = False


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
    }


@app.errorhandler(data_service.ExcelLockedError)
def handle_excel_locked(error):
    return jsonify({"ok": False, "error": str(error)}), 423


@app.errorhandler(data_service.MovieNotFoundError)
def handle_movie_not_found(error):
    return jsonify({"ok": False, "error": str(error)}), 404


@app.route("/")
def home():
    """Data status check: confirms the Excel file loads and is cleaned."""
    df = data_service.load_movies()
    has_money = df["profit"].notna()
    return jsonify({
        "site": SITE_NAME,
        "excel_file": data_service.XLSX_PATH,
        "movies": int(len(df)),
        "year_range": [int(df["year"].min()), int(df["year"].max())],
        "rows_missing_budget": int(df["budget"].isna().sum()),
        "rows_with_budget_and_gross": int(has_money.sum()),
        "ratings": df["rating"].value_counts().to_dict(),
        "columns": list(df.columns),
    })


if __name__ == "__main__":
    if data_service.ensure_excel():
        print("Created data/movies.xlsx from data/movies.csv")
    app.run(debug=True)
