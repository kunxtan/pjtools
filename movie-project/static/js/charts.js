/* CineScope — charts on the analysis page (Chart.js 4).
 *
 * The data comes from <script id="analysis-data"> which the server fills
 * from analysis.py, so the charts always match the current Excel file.
 * Every chart also has a table view in the HTML, so no value is chart-only.
 */
(() => {
  const dataElement = document.getElementById("analysis-data");
  if (!dataElement) return;
  const DATA = JSON.parse(dataElement.textContent);

  const COLORS = {
    text: "#f4efe3",
    muted: "#c4bca8",
    grid: "rgba(244, 239, 227, 0.08)",
    gold: "#f2c14e",
    blue: "#468de5",
    fitLine: "#ff7f8f",
    surface: "#0e1733",
    tooltip: "#05060d",
  };
  const FONT = '"Noto Sans Thai", "Leelawadee UI", Tahoma, sans-serif';
  const GENRE_COLORS = (window.CINESCOPE && window.CINESCOPE.genreColors) || {};
  const DEFAULT_GENRE_COLOR = "#7c8799";

  /* ------------------------------------------------------------ formatters */
  function formatMoney(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    const sign = value < 0 ? "-" : "";
    const amount = Math.abs(value);
    if (amount >= 1e9) return `${sign}$${(amount / 1e9).toFixed(1)}B`;
    if (amount >= 1e6) return `${sign}$${(amount / 1e6).toFixed(1)}M`;
    if (amount >= 1e3) return `${sign}$${(amount / 1e3).toFixed(0)}K`;
    return `${sign}$${amount.toFixed(0)}`;
  }
  // Axis ticks: shorter, no decimals for round values ($0, $500M, $1B)
  function formatMoneyTick(value) {
    const amount = Math.abs(value);
    if (amount >= 1e9) return `$${+(value / 1e9).toFixed(1)}B`;
    if (amount >= 1e6) return `$${+(value / 1e6).toFixed(0)}M`;
    if (amount >= 1e3) return `$${+(value / 1e3).toFixed(0)}K`;
    return `$${value}`;
  }
  const formatNumber = (value, digits = 0) =>
    Number(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

  /* --------------------------------------------------------------- plugins */

  // Value at the tip of each horizontal bar (text colour, never the bar colour).
  const barValueLabels = {
    id: "barValueLabels",
    afterDatasetsDraw(chart, args, options) {
      if (!options || !options.format) return;
      const { ctx } = chart;
      ctx.save();
      ctx.font = `500 12px ${FONT}`;
      ctx.fillStyle = COLORS.text;
      ctx.textBaseline = "middle";
      chart.getDatasetMeta(0).data.forEach((bar, index) => {
        const value = chart.data.datasets[0].data[index];
        ctx.fillText(options.format(value), bar.x + 6, bar.y);
      });
      ctx.restore();
    },
  };

  // Vertical hairline that follows the hovered year on line charts.
  const crosshair = {
    id: "crosshair",
    afterDatasetsDraw(chart, args, options) {
      if (!options || !options.enabled) return;
      const active = chart.tooltip && chart.tooltip.getActiveElements();
      if (!active || !active.length) return;
      const x = active[0].element.x;
      const { top, bottom } = chart.chartArea;
      const { ctx } = chart;
      ctx.save();
      ctx.strokeStyle = "rgba(244, 239, 227, 0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.restore();
    },
  };

  // A labelled vertical reference line at a given x value (ROI = 1).
  const referenceLine = {
    id: "referenceLine",
    afterDatasetsDraw(chart, args, options) {
      if (!options || options.value === undefined) return;
      const x = chart.scales.x.getPixelForValue(options.value);
      const { top, bottom } = chart.chartArea;
      const { ctx } = chart;
      ctx.save();
      ctx.strokeStyle = COLORS.text;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      // Label sits in the padding above the plot so it never covers a bar.
      ctx.font = `600 12px ${FONT}`;
      ctx.fillStyle = COLORS.text;
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(options.label, x, top - 4);
      ctx.restore();
    },
  };

  /* -------------------------------------------------------------- defaults */
  function applyDefaults() {
    Chart.register(barValueLabels, crosshair, referenceLine);
    Chart.defaults.font.family = FONT;
    Chart.defaults.font.size = 13;
    Chart.defaults.color = COLORS.muted;
    Chart.defaults.borderColor = COLORS.grid;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.responsive = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      Chart.defaults.animation = false;
    }
    const tooltip = Chart.defaults.plugins.tooltip;
    tooltip.backgroundColor = COLORS.tooltip;
    tooltip.borderColor = "rgba(242, 193, 78, 0.5)";
    tooltip.borderWidth = 1;
    tooltip.padding = 10;
    tooltip.titleColor = COLORS.muted;
    tooltip.titleFont = { weight: "500", size: 12 };
    tooltip.bodyColor = COLORS.text;
    tooltip.bodyFont = { weight: "700", size: 14 };
    tooltip.footerColor = COLORS.muted;
    tooltip.footerFont = { weight: "400", size: 12 };
    tooltip.boxPadding = 4;
    const legend = Chart.defaults.plugins.legend;
    legend.labels.color = COLORS.text;
    legend.labels.usePointStyle = true;
    legend.labels.boxHeight = 8;
  }

  const axis = (extra = {}) => ({
    grid: { color: COLORS.grid, drawTicks: false },
    border: { color: COLORS.grid },
    ticks: { color: COLORS.muted, padding: 8 },
    ...extra,
  });

  /* ---------------------------------------------------------- chart makers */

  // Horizontal ranked bars. `colorFor(label)` picks each bar colour.
  function horizontalBars(canvasId, series, { format, axisFormat, colorFor, footer, reference }) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !series) return;
    const colors = series.labels.map((label) => colorFor(label));
    new Chart(canvas, {
      type: "bar",
      data: {
        labels: series.labels,
        datasets: [{
          data: series.values,
          backgroundColor: colors,
          hoverBackgroundColor: colors.map((c) => `${c}cc`),
          borderRadius: 4,
          borderSkipped: "start", // round only the data end, square at the baseline
          maxBarThickness: 24,
          categoryPercentage: 0.8,
          barPercentage: 0.9,
        }],
      },
      options: {
        indexAxis: "y",
        layout: { padding: { right: 64, top: reference ? 22 : 0 } },
        scales: {
          x: axis({ beginAtZero: true, ticks: { color: COLORS.muted, padding: 8, callback: axisFormat || format } }),
          y: axis({ grid: { display: false }, ticks: { color: COLORS.text, padding: 8 } }),
        },
        plugins: {
          legend: { display: false },
          barValueLabels: { format },
          referenceLine: reference,
          tooltip: {
            callbacks: {
              title: (items) => items[0].label,
              label: (item) => format(item.raw),
              footer: (items) => footer(items[0].dataIndex),
            },
          },
        },
      },
    });
  }

  // `yMin` / `yMax` keep the axis to values the data can take (the fit line
  // can run past them at the ends; it is simply clipped at the plot edge).
  function scatterWithFit(canvasId, chart, { xLabel, yLabel, xFormat, yFormat, pointTitle, pointColor, xMin, yMin, yMax }) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || !chart) return;
    const points = chart.points.map((p) => ({ x: p[0], y: p[1], meta: p }));
    const line = chart.line.map(([x, y]) => ({ x, y }));
    new Chart(canvas, {
      type: "scatter",
      data: {
        datasets: [
          {
            label: "หนังแต่ละเรื่อง",
            data: points,
            backgroundColor: pointColor,
            borderWidth: 0,
            pointRadius: 2.5,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: COLORS.gold,
            pointHoverBorderColor: COLORS.surface,
            pointHoverBorderWidth: 2,
            pointStyle: "circle",
          },
          {
            type: "line",
            label: "เส้น regression",
            data: line,
            borderColor: COLORS.fitLine,
            borderWidth: 2,
            borderCapStyle: "round",
            pointRadius: 0,
            pointHoverRadius: 0,
            pointStyle: "line",
          },
        ],
      },
      options: {
        // Nearest point, not exact hit: tiny dots are hard to land on.
        interaction: { mode: "nearest", intersect: false, axis: "xy" },
        scales: {
          x: axis({
            min: xMin,
            title: { display: true, text: xLabel, color: COLORS.text },
            ticks: { color: COLORS.muted, padding: 8, callback: xFormat, maxRotation: 0, autoSkipPadding: 16 },
          }),
          y: axis({
            min: yMin,
            max: yMax,
            title: { display: true, text: yLabel, color: COLORS.text },
            ticks: { color: COLORS.muted, padding: 8, callback: yFormat },
          }),
        },
        plugins: {
          legend: { position: "top", align: "start" },
          tooltip: {
            filter: (item) => item.datasetIndex === 0,
            callbacks: {
              title: (items) => pointTitle(items[0].raw.meta),
              label: (item) => `${yLabel}: ${yFormat(item.raw.y)}`,
              afterLabel: (item) => `${xLabel}: ${xFormat(item.raw.x)}`,
            },
          },
        },
      },
    });
  }

  function lineChart(canvasId, labels, datasets, { format, tickFormat, footer }) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: datasets.map((d) => ({
          label: d.label,
          data: d.data,
          borderColor: d.color,
          backgroundColor: d.color,
          borderWidth: 2,
          borderCapStyle: "round",
          borderJoinStyle: "round",
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBorderColor: COLORS.surface,
          pointHoverBorderWidth: 2,
          pointStyle: "line",
          tension: 0.25,
        })),
      },
      options: {
        interaction: { mode: "index", intersect: false },
        scales: {
          x: axis({ grid: { display: false }, ticks: { color: COLORS.muted, padding: 8, maxRotation: 0, autoSkipPadding: 12 } }),
          y: axis({ beginAtZero: true, ticks: { color: COLORS.muted, padding: 8, callback: tickFormat || format } }),
        },
        plugins: {
          legend: { display: datasets.length > 1, position: "top", align: "start" },
          crosshair: { enabled: true },
          tooltip: {
            callbacks: {
              title: (items) => `ปี ${items[0].label}`,
              label: (item) => ` ${item.dataset.label}: ${format(item.raw)}`,
              footer: footer ? (items) => footer(items[0].dataIndex) : undefined,
            },
          },
        },
      },
    });
  }

  /* --------------------------------------------------------- build charts */
  const genreColor = (genre) => GENRE_COLORS[genre] || DEFAULT_GENRE_COLOR;
  const countFooter = (series) => (index) => `จาก ${formatNumber(series.counts[index])} เรื่อง`;

  function buildCharts() {
    applyDefaults();

    scatterWithFit("chart-budget-gross", DATA.budget_gross, {
      xLabel: "ทุนสร้าง",
      yLabel: "รายได้",
      xFormat: formatMoneyTick,
      yFormat: formatMoneyTick,
      pointColor: "rgba(242, 193, 78, 0.35)",
      pointTitle: (meta) => `${meta[2]} (${meta[3]})`,
      xMin: 0,
      yMin: 0,
    });

    if (DATA.genre_gross) {
      horizontalBars("chart-genre-gross", DATA.genre_gross, {
        format: formatMoney, axisFormat: formatMoneyTick, colorFor: genreColor,
        footer: countFooter(DATA.genre_gross),
      });
    }
    if (DATA.genre_score) {
      horizontalBars("chart-genre-score", DATA.genre_score, {
        format: (v) => formatNumber(v, 2), axisFormat: (v) => v, colorFor: genreColor,
        footer: countFooter(DATA.genre_score),
      });
    }

    if (DATA.year_count) {
      lineChart("chart-year-count", DATA.year_count.labels,
        [{ label: "จำนวนหนัง", data: DATA.year_count.values, color: COLORS.gold }],
        { format: (v) => `${formatNumber(v)} เรื่อง`, tickFormat: (v) => formatNumber(v) });
    }
    if (DATA.year_money) {
      lineChart("chart-year-money", DATA.year_money.labels, [
        { label: "รายได้เฉลี่ย", data: DATA.year_money.gross, color: COLORS.gold },
        { label: "ทุนสร้างเฉลี่ย", data: DATA.year_money.budget, color: COLORS.blue },
      ], {
        format: formatMoney,
        tickFormat: formatMoneyTick,
        footer: (index) => `คำนวณจาก ${formatNumber(DATA.year_money.counts[index])} เรื่อง`,
      });
    }

    const singleColor = () => COLORS.gold;
    if (DATA.top_companies) {
      horizontalBars("chart-top-companies", DATA.top_companies, {
        format: formatMoney, axisFormat: formatMoneyTick, colorFor: singleColor,
        footer: countFooter(DATA.top_companies),
      });
    }
    if (DATA.top_directors) {
      horizontalBars("chart-top-directors", DATA.top_directors, {
        format: formatMoney, axisFormat: formatMoneyTick, colorFor: singleColor,
        footer: countFooter(DATA.top_directors),
      });
    }

    scatterWithFit("chart-runtime-score", DATA.runtime_score, {
      xLabel: "ความยาว (นาที)",
      yLabel: "คะแนน",
      xFormat: (v) => formatNumber(v),
      yFormat: (v) => formatNumber(v, 1),
      pointColor: "rgba(242, 193, 78, 0.3)",
      pointTitle: () => "หนัง 1 เรื่อง",
      yMin: 0,
      yMax: 10,
    });

    if (DATA.genre_roi) {
      horizontalBars("chart-genre-roi", DATA.genre_roi, {
        format: (v) => `${formatNumber(v, 2)} เท่า`, axisFormat: (v) => `${v}×`, colorFor: genreColor,
        footer: countFooter(DATA.genre_roi),
        reference: { value: 1, label: "เท่าทุน (ROI 1)" },
      });
    }
  }

  function showLoadError() {
    document.querySelectorAll(".chart-box").forEach((box) => {
      box.classList.add("chart-box--error");
      box.textContent = "โหลดกราฟไม่ได้ (ต้องต่ออินเทอร์เน็ตเพื่อโหลด Chart.js) ดูตัวเลขได้จากตารางใต้กราฟ";
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (typeof Chart === "undefined") {
      showLoadError();
      return;
    }
    // Wait for the web fonts so chart text uses Noto Sans Thai from the start.
    const fontsReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
    fontsReady.then(buildCharts);
  });
})();
