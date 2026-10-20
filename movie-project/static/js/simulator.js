/* CineScope — Box Office Simulator.
 *
 * Sends the chosen ingredients to /api/simulate (the regression runs on the
 * server) and plays the result as a sequence:
 *   1. clapperboard snaps shut   2. film strip rolls across the screen
 *   3. box-office counter spins  4. stars fill one by one
 *   5. marquee shows BLOCKBUSTER / HIT / BREAK EVEN / FLOP
 * With prefers-reduced-motion the result is shown immediately.
 */
(() => {
  const form = document.getElementById("sim-form");
  if (!form) return;

  const $ = (id) => document.getElementById(id);
  const els = {
    button: $("sim-button"),
    buttonLabel: form.querySelector(".sim-button__label"),
    budget: $("budget-slider"),
    runtime: $("runtime-slider"),
    year: $("year-slider"),
    rating: $("rating-select"),
    budgetOut: $("budget-output"),
    runtimeOut: $("runtime-output"),
    yearOut: $("year-output"),
    stage: $("sim-stage"),
    clapper: $("sim-clapper"),
    clapperScene: $("clapper-scene"),
    clapperTake: $("clapper-take"),
    placeholder: $("sim-placeholder"),
    error: $("sim-error"),
    result: $("sim-result"),
    odometer: $("gross-odometer"),
    grossText: $("gross-text"),
    grossRange: $("gross-range"),
    stars: Array.from(document.querySelectorAll("#stars .star")),
    scoreText: $("score-text"),
    profit: $("profit-value"),
    roi: $("roi-value"),
    r2Revenue: $("r2-revenue"),
    r2Score: $("r2-score"),
    verdict: $("verdict"),
    verdictLabel: $("verdict-label"),
    verdictDesc: $("verdict-desc"),
    similarPanel: $("similar-panel"),
    similarNote: $("similar-note"),
    similarBody: $("similar-body"),
    historyBody: $("history-body"),
    filmPass: $("film-pass"),
  };

  const BUDGET_MIN = Number(form.dataset.budgetMin);
  const BUDGET_MAX = Number(form.dataset.budgetMax);
  const HISTORY_SIZE = 5;
  const VERDICT_KEYS = ["blockbuster", "hit", "breakeven", "flop"];

  const state = { running: false, take: 0, history: [] };

  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, reducedMotion() ? 0 : ms));
  const play = (sound) => {
    if (typeof CineAudio !== "undefined") CineAudio.play(sound);
  };

  /* ------------------------------------------------------------ formatting */
  function formatMoney(value) {
    const sign = value < 0 ? "-" : "";
    const amount = Math.abs(value);
    if (amount >= 1e9) return `${sign}$${(amount / 1e9).toFixed(1)}B`;
    if (amount >= 1e6) return `${sign}$${(amount / 1e6).toFixed(1)}M`;
    if (amount >= 1e3) return `${sign}$${(amount / 1e3).toFixed(0)}K`;
    return `${sign}$${amount.toFixed(0)}`;
  }
  const formatNumber = (value, digits = 0) =>
    Number(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

  /* ------------------------------------------------- budget slider (log) */
  // The slider runs 0-1000; positions map to budgets on a log scale so that
  // both $50K and $300M are easy to pick.
  function sliderToBudget(position) {
    const raw = BUDGET_MIN * Math.pow(BUDGET_MAX / BUDGET_MIN, position / 1000);
    const step = raw >= 1e6 ? 1e5 : raw >= 1e5 ? 1e4 : 1e3; // round to tidy amounts
    return Math.min(BUDGET_MAX, Math.max(BUDGET_MIN, Math.round(raw / step) * step));
  }
  function budgetToSlider(budget) {
    return Math.round((1000 * Math.log(budget / BUDGET_MIN)) / Math.log(BUDGET_MAX / BUDGET_MIN));
  }

  function updateOutputs() {
    const budget = sliderToBudget(Number(els.budget.value));
    els.budgetOut.textContent = formatMoney(budget);
    els.budget.setAttribute("aria-valuetext", formatMoney(budget));
    els.runtimeOut.textContent = `${els.runtime.value} นาที`;
    els.runtime.setAttribute("aria-valuetext", `${els.runtime.value} นาที`);
    els.yearOut.textContent = els.year.value;
  }

  function readInputs() {
    const genre = form.querySelector('input[name="genre"]:checked');
    return {
      genre: genre ? genre.value : "",
      budget: sliderToBudget(Number(els.budget.value)),
      runtime: Number(els.runtime.value),
      year: Number(els.year.value),
      rating: els.rating.value,
    };
  }

  /* --------------------------------------------------------------- stage */
  function resetStage() {
    els.error.hidden = true;
    els.placeholder.hidden = true;
    els.result.hidden = true;
    els.verdict.hidden = true;
    els.verdict.classList.remove(...VERDICT_KEYS.map((k) => `verdict--${k}`));
    els.clapper.classList.remove("is-clapping");
    els.stars.forEach((star) => star.style.setProperty("--fill", "0%"));
  }

  // Box-office counter: each digit is a reel of 0-9 (three times over) that
  // spins down to its final digit; later digits spin a little longer.
  function rollOdometer(amount) {
    const rounded = Math.round(amount / 1e5) * 1e5; // an estimate: no false precision
    const text = `$${rounded.toLocaleString("en-US")}`;
    els.odometer.textContent = "";
    const reels = [];
    let digitIndex = 0;
    for (const char of text) {
      if (/\d/.test(char)) {
        const digit = document.createElement("span");
        digit.className = "odo-digit";
        const reel = document.createElement("span");
        reel.className = "odo-reel";
        for (let i = 0; i < 30; i++) {
          const n = document.createElement("span");
          n.textContent = String(i % 10);
          reel.appendChild(n);
        }
        reel.style.transitionDuration = `${1.1 + digitIndex * 0.07}s`;
        digit.appendChild(reel);
        els.odometer.appendChild(digit);
        reels.push([reel, 20 + Number(char)]);
        digitIndex += 1;
      } else {
        const sep = document.createElement("span");
        sep.className = "odo-sep";
        sep.textContent = char;
        els.odometer.appendChild(sep);
      }
    }
    // Two frames later so the browser paints the start position first.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      reels.forEach(([reel, target]) => { reel.style.transform = `translateY(-${target}em)`; });
    }));
    return 1100 + digitIndex * 70;
  }

  async function fillStars(score) {
    for (let i = 0; i < els.stars.length; i++) {
      const fill = Math.max(0, Math.min(1, score - i)) * 100;
      els.stars[i].style.setProperty("--fill", `${fill}%`);
      if (fill > 0) await wait(110);
    }
  }

  function showVerdict(verdict) {
    els.verdictLabel.textContent = verdict.label;
    els.verdictDesc.textContent = verdict.description;
    els.verdict.classList.add(`verdict--${verdict.key}`);
    els.verdict.hidden = false;
    play(verdict.key);
  }

  function showStats(data) {
    els.profit.textContent = formatMoney(data.profit);
    els.roi.textContent = `${formatNumber(data.roi, 2)}×`;
    els.r2Revenue.textContent = formatNumber(data.models.revenue.r2, 2);
    els.r2Score.textContent = formatNumber(data.models.score.r2, 2);
    els.grossRange.textContent =
      `ช่วงที่หนังจริงครึ่งหนึ่งตกอยู่: ${formatMoney(data.gross.low)} – ${formatMoney(data.gross.high)}`;
    els.grossText.textContent = `รายได้ที่คาดการณ์ ${formatMoney(data.gross.predicted)}`;
    els.scoreText.textContent = `${formatNumber(data.score, 1)} / 10`;
  }

  function cell(text, className) {
    const td = document.createElement("td");
    td.textContent = text;
    if (className) td.className = className;
    return td;
  }

  function showSimilar(data) {
    els.similarBody.textContent = "";
    data.similar.forEach((movie) => {
      const row = document.createElement("tr");
      const name = document.createElement("th");
      name.scope = "row";
      name.textContent = movie.name; // names come from data: always textContent
      row.append(
        name,
        cell(String(movie.year), "col-num"),
        cell(movie.rating || "—"),
        cell(formatMoney(movie.budget), "col-num"),
        cell(formatMoney(movie.gross), "col-num"),
        cell(`${formatNumber(movie.roi, 2)}×`, "col-num"),
        cell(movie.score === null ? "—" : formatNumber(movie.score, 1), "col-num"),
      );
      els.similarBody.appendChild(row);
    });
    els.similarNote.textContent =
      `ประเภท ${data.input.genre} ทุนสร้างใกล้กับ ${formatMoney(data.input.budget)} ` +
      `${data.input.rating ? `(เลือกเรท ${data.input.rating} ก่อน) ` : ""}` +
      `เทียบกับรายได้คาดการณ์ของคุณ ${formatMoney(data.gross.predicted)}`;
    els.similarPanel.hidden = data.similar.length === 0;
  }

  function addHistory(data) {
    state.history.unshift({ take: state.take, input: data.input, data });
    state.history = state.history.slice(0, HISTORY_SIZE);
    els.historyBody.textContent = "";
    state.history.forEach(({ take, input, data: d }) => {
      const row = document.createElement("tr");
      const verdict = document.createElement("td");
      const badge = document.createElement("span");
      badge.className = `verdict-badge verdict-badge--${d.verdict.key}`;
      badge.textContent = d.verdict.label;
      verdict.appendChild(badge);
      row.append(
        cell(`#${take}`),
        cell(input.genre),
        cell(formatMoney(input.budget), "col-num"),
        cell(`${input.runtime} นาที`, "col-num"),
        cell(input.rating || "—"),
        cell(String(input.year), "col-num"),
        cell(formatMoney(d.gross.predicted), "col-num"),
        cell(`${formatNumber(d.roi, 2)}×`, "col-num"),
        cell(formatNumber(d.score, 1), "col-num"),
        verdict,
      );
      els.historyBody.appendChild(row);
    });
  }

  function showError(message) {
    els.result.hidden = true;
    els.error.textContent = message;
    els.error.hidden = false;
    announce(message);
  }

  /* ------------------------------------------------------------- the run */
  async function requestSimulation(input) {
    try {
      const response = await fetch("/api/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        const details = data.errors ? Object.values(data.errors).join(" ") : "";
        return { error: `${data.error || "คำนวณไม่สำเร็จ"} ${details}`.trim() };
      }
      return { data };
    } catch (error) {
      return { error: "ติดต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบว่าเว็บยังรันอยู่ แล้วลองใหม่" };
    }
  }

  async function run() {
    if (state.running) return;
    state.running = true;
    els.button.disabled = true;
    els.stage.setAttribute("aria-busy", "true");

    const input = readInputs();
    const pending = requestSimulation(input); // runs while the animation plays

    state.take += 1;
    resetStage();
    els.clapperScene.textContent = input.genre;
    els.clapperTake.textContent = String(state.take);
    const animate = !reducedMotion();

    // 1. Clapperboard snaps shut
    await wait(300);
    els.clapper.classList.add("is-clapping");
    if (animate) play("clapper");
    await wait(450);

    // 2. Film strip rolls across the screen
    if (animate) {
      play("film");
      els.filmPass.classList.add("is-running");
      await wait(1300);
      els.filmPass.classList.remove("is-running");
    }

    const { data, error } = await pending;
    if (error) {
      showError(error);
      finish();
      return;
    }

    // 3. Box-office counter spins to the predicted gross
    showStats(data);
    els.result.hidden = false;
    if (animate) play("cash");
    const rollTime = rollOdometer(data.gross.predicted);
    await wait(rollTime);

    // 4. Stars fill one by one
    await fillStars(data.score);

    // 5. Marquee verdict
    await wait(200);
    showVerdict(data.verdict);

    showSimilar(data);
    addHistory(data);
    announce(
      `ผลการจำลอง: ${data.verdict.label} รายได้ที่คาดการณ์ ${formatMoney(data.gross.predicted)} ` +
      `ROI ${formatNumber(data.roi, 2)} เท่า คะแนนที่คาดการณ์ ${formatNumber(data.score, 1)} จาก 10`
    );
    els.buttonLabel.textContent = "ลองอีกแบบ";
    finish();
  }

  function finish() {
    state.running = false;
    els.button.disabled = false;
    els.stage.setAttribute("aria-busy", "false");
  }

  /* ---------------------------------------------------------------- init */
  els.budget.value = budgetToSlider(Number(form.dataset.budgetDefault));
  updateOutputs();
  [els.budget, els.runtime, els.year].forEach((slider) => slider.addEventListener("input", updateOutputs));
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    run();
  });
})();
