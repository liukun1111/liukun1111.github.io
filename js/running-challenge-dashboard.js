(() => {
  const STATE_KEY = "__runningChallengeDashboard__";
  const ECHARTS_PROMISE_KEY = "__runningChallengeEchartsPromise__";
  const ROOT_ID = "running-challenge-dashboard";
  const ECHARTS_SCRIPT_ID = "running-challenge-echarts-cdn";
  const ECHARTS_SRC = "https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js";

  function cleanupOldInstance() {
    const oldState = window[STATE_KEY];
    if (!oldState) return;

    if (oldState.themeObserver) oldState.themeObserver.disconnect();
    if (oldState.resizeHandler) window.removeEventListener("resize", oldState.resizeHandler);
    if (oldState.charts && oldState.charts.main) oldState.charts.main.dispose();
    if (oldState.charts && oldState.charts.pace) oldState.charts.pace.dispose();

    delete window[STATE_KEY];
  }

  function normalizeText(text) {
    return (text || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parsePaceToSeconds(rawPace) {
    if (!rawPace) return null;
    const normalized = rawPace.replace("：", ":").replace(/\s+/g, "");
    const parts = normalized.split(":");
    if (parts.length !== 2) return null;

    const minutes = Number(parts[0]);
    const seconds = Number(parts[1]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    if (seconds < 0 || seconds >= 60) return null;

    return minutes * 60 + seconds;
  }

  function formatPace(seconds) {
    if (!Number.isFinite(seconds)) return "—";
    const min = Math.floor(seconds / 60);
    const sec = Math.round(seconds % 60);
    return `${min}:${String(sec).padStart(2, "0")}`;
  }

  function formatDistance(value) {
    if (!Number.isFinite(value)) return "—";
    return value.toFixed(2).replace(/\.?0+$/, "");
  }

  function buildDeltaHtml(delta, formatter, options = {}) {
    const upPrefix = Object.prototype.hasOwnProperty.call(options, "upPrefix") ? options.upPrefix : "+";
    const downPrefix = Object.prototype.hasOwnProperty.call(options, "downPrefix") ? options.downPrefix : "-";
    const flatText = Object.prototype.hasOwnProperty.call(options, "flatText") ? options.flatText : "→ 0";

    if (!Number.isFinite(delta)) {
      return '<span class="rc-delta rc-delta-flat">—</span>';
    }

    if (Math.abs(delta) < 1e-9) {
      return `<span class="rc-delta rc-delta-flat">${flatText}</span>`;
    }

    if (delta > 0) {
      return `<span class="rc-delta rc-delta-up">▲ ${upPrefix}${formatter(Math.abs(delta))}</span>`;
    }

    return `<span class="rc-delta rc-delta-down">▼ ${downPrefix}${formatter(Math.abs(delta))}</span>`;
  }

  function buildMetricCell(mainText, deltaHtml) {
    return `
      <div class="rc-metric-cell">
        <div class="rc-metric-main">${mainText}</div>
        <div class="rc-metric-delta">${deltaHtml}</div>
      </div>
    `;
  }

  function parseRunningData() {
    const article = document.querySelector("#article-container");
    if (!article) return [];

    const paragraphs = article.querySelectorAll("p");
    const byDay = new Map();

    const lineRegex =
      /Day\s*(\d+).*?今日圈数[:：]\s*(\d+).*?累计圈数[:：]\s*(\d+).*?今日里程[:：]\s*([0-9]+(?:\.[0-9]+)?)\s*km.*?累计里程[:：]\s*([0-9]+(?:\.[0-9]+)?)\s*km/i;
    const paceRegex = /(?:平均|今日)配速[:：]\s*([0-9]{1,2}\s*[:：]\s*[0-9]{2})\s*\/?\s*km/i;

    paragraphs.forEach((paragraph) => {
      const text = normalizeText(paragraph.textContent);
      if (!/Day\s*\d+/i.test(text)) return;

      const match = text.match(lineRegex);
      if (!match) return;

      const day = Number(match[1]);
      const dailyLaps = Number(match[2]);
      const totalLaps = Number(match[3]);
      const dailyDistance = Number(match[4]);
      const totalDistance = Number(match[5]);

      if (
        !Number.isFinite(day) ||
        !Number.isFinite(dailyLaps) ||
        !Number.isFinite(totalLaps) ||
        !Number.isFinite(dailyDistance) ||
        !Number.isFinite(totalDistance)
      ) {
        return;
      }

      const paceMatch = text.match(paceRegex);
      const paceText = paceMatch ? paceMatch[1].replace(/\s+/g, "").replace("：", ":") : null;
      const paceSeconds = parsePaceToSeconds(paceText);

      // Same day keeps the latest line in article order.
      byDay.set(day, {
        day,
        dailyLaps,
        totalLaps,
        dailyDistance,
        totalDistance,
        paceText: paceSeconds !== null ? paceText : null,
        paceSeconds
      });
    });

    return Array.from(byDay.values()).sort((a, b) => a.day - b.day);
  }

  function renderSummary(root, data) {
    const dayCountEl = root.querySelector('[data-role="summary-days"]');
    const totalDistanceEl = root.querySelector('[data-role="summary-total-distance"]');
    const avgDistanceEl = root.querySelector('[data-role="summary-avg-distance"]');
    const avgPaceEl = root.querySelector('[data-role="summary-avg-pace"]');

    if (!dayCountEl || !totalDistanceEl || !avgDistanceEl || !avgPaceEl) return;

    if (!data.length) {
      dayCountEl.textContent = "0 天";
      totalDistanceEl.textContent = "0 km";
      avgDistanceEl.textContent = "0 km/天";
      avgPaceEl.textContent = "—";
      return;
    }

    const dayCount = data.length;
    const totalDistance = data[data.length - 1].totalDistance;
    const avgDistance = data.reduce((sum, item) => sum + item.dailyDistance, 0) / dayCount;

    const paceItems = data.filter((item) => Number.isFinite(item.paceSeconds));
    const avgPace =
      paceItems.length > 0
        ? Math.round(paceItems.reduce((sum, item) => sum + item.paceSeconds, 0) / paceItems.length)
        : null;

    dayCountEl.textContent = `${dayCount} 天`;
    totalDistanceEl.textContent = `${formatDistance(totalDistance)} km`;
    avgDistanceEl.textContent = `${formatDistance(avgDistance)} km/天`;
    avgPaceEl.textContent = avgPace !== null ? `${formatPace(avgPace)} /km` : "—";
  }

  function renderTable(root, data) {
    const tbody = root.querySelector('[data-role="stats-tbody"]');
    if (!tbody) return;

    tbody.innerHTML = "";

    if (!data.length) {
      const row = document.createElement("tr");
      row.innerHTML = '<td colspan="6" class="rc-dashboard-empty">还没有可统计的 Day 数据</td>';
      tbody.appendChild(row);
      return;
    }

    data.forEach((item, index) => {
      const prev = index > 0 ? data[index - 1] : null;

      const lapsDelta = prev ? item.dailyLaps - prev.dailyLaps : NaN;
      const totalLapsDelta = prev ? item.totalLaps - prev.totalLaps : NaN;
      const dailyDistanceDelta = prev ? item.dailyDistance - prev.dailyDistance : NaN;
      const totalDistanceDelta = prev ? item.totalDistance - prev.totalDistance : NaN;
      const paceDelta =
        prev && Number.isFinite(item.paceSeconds) && Number.isFinite(prev.paceSeconds)
          ? item.paceSeconds - prev.paceSeconds
          : NaN;

      const row = document.createElement("tr");
      row.innerHTML = `
        <td>Day ${item.day}</td>
        <td>${buildMetricCell(String(item.dailyLaps), buildDeltaHtml(lapsDelta, (v) => String(Math.round(v))))}</td>
        <td>${buildMetricCell(String(item.totalLaps), buildDeltaHtml(totalLapsDelta, (v) => String(Math.round(v))))}</td>
        <td>${buildMetricCell(`${formatDistance(item.dailyDistance)} km`, buildDeltaHtml(dailyDistanceDelta, (v) => formatDistance(v)))}</td>
        <td>${buildMetricCell(`${formatDistance(item.totalDistance)} km`, buildDeltaHtml(totalDistanceDelta, (v) => formatDistance(v)))}</td>
        <td>${buildMetricCell(
          item.paceText ? `${item.paceText} /km` : "—",
          buildDeltaHtml(-paceDelta, (v) => `${formatPace(v)} /km`, {
            upPrefix: "快 ",
            downPrefix: "慢 ",
            flatText: "→ 持平"
          })
        )}</td>
      `;
      tbody.appendChild(row);
    });
  }

  function getThemeTokens() {
    const styles = getComputedStyle(document.documentElement);
    const mode = document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";

    const textColor = (styles.getPropertyValue("--anzhiyu-fontcolor") || "").trim() || "#1f2d3d";
    const subTextColor = (styles.getPropertyValue("--anzhiyu-secondtext") || "").trim() || "#6f7a8a";
    const mainColor = (styles.getPropertyValue("--anzhiyu-main") || "").trim() || "#2e7bff";

    return {
      mode,
      textColor,
      subTextColor,
      mainColor,
      gridLineColor: mode === "dark" ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)",
      splitLineColor: mode === "dark" ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)",
      dailyDistanceColor: mode === "dark" ? "#4ea1ff" : "#3a86ff",
      totalDistanceColor: mode === "dark" ? "#5ad8a6" : "#00a870",
      dailyLapsColor: mode === "dark" ? "#f6bd16" : "#fa8c16",
      paceColor: mode === "dark" ? "#ff85c0" : "#eb2f96"
    };
  }

  function createMainChartOption(data, theme) {
    return {
      animationDuration: 450,
      color: [theme.dailyDistanceColor, theme.totalDistanceColor, theme.dailyLapsColor],
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        backgroundColor: theme.mode === "dark" ? "rgba(30,30,34,0.92)" : "rgba(255,255,255,0.96)",
        borderColor: theme.gridLineColor,
        textStyle: { color: theme.textColor }
      },
      legend: {
        top: 0,
        textStyle: { color: theme.subTextColor },
        data: ["今日里程", "累计里程", "今日圈数"]
      },
      grid: {
        top: 48,
        left: 52,
        right: 60,
        bottom: 36
      },
      xAxis: {
        type: "category",
        boundaryGap: true,
        data: data.map((item) => `D${item.day}`),
        axisLine: { lineStyle: { color: theme.gridLineColor } },
        axisLabel: { color: theme.subTextColor }
      },
      yAxis: [
        {
          type: "value",
          name: "里程 (km)",
          nameTextStyle: { color: theme.subTextColor },
          axisLabel: {
            color: theme.subTextColor,
            formatter: "{value}"
          },
          splitLine: { lineStyle: { color: theme.splitLineColor } }
        },
        {
          type: "value",
          name: "圈数",
          nameTextStyle: { color: theme.subTextColor },
          axisLabel: { color: theme.subTextColor, formatter: "{value}" },
          splitLine: { show: false }
        }
      ],
      series: [
        {
          name: "今日里程",
          type: "bar",
          barMaxWidth: 20,
          data: data.map((item) => Number(item.dailyDistance.toFixed(2)))
        },
        {
          name: "累计里程",
          type: "line",
          smooth: true,
          symbolSize: 8,
          data: data.map((item) => Number(item.totalDistance.toFixed(2)))
        },
        {
          name: "今日圈数",
          type: "line",
          yAxisIndex: 1,
          smooth: true,
          symbolSize: 7,
          data: data.map((item) => item.dailyLaps)
        }
      ]
    };
  }

  function createPaceChartOption(data, theme) {
    return {
      animationDuration: 450,
      color: [theme.paceColor],
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "line" },
        backgroundColor: theme.mode === "dark" ? "rgba(30,30,34,0.92)" : "rgba(255,255,255,0.96)",
        borderColor: theme.gridLineColor,
        textStyle: { color: theme.textColor },
        formatter: (params) => {
          const point = params && params[0] ? params[0] : null;
          if (!point) return "";

          const currentIndex = point.dataIndex;
          const current = data[currentIndex] ? data[currentIndex].paceSeconds : null;
          const previous = currentIndex > 0 && data[currentIndex - 1] ? data[currentIndex - 1].paceSeconds : null;

          let deltaText = "";
          if (Number.isFinite(current) && Number.isFinite(previous)) {
            const delta = current - previous;
            if (Math.abs(delta) < 1e-9) {
              deltaText = "较前一天：持平";
            } else if (delta < 0) {
              deltaText = `较前一天：快 ${formatPace(Math.abs(delta))} /km`;
            } else {
              deltaText = `较前一天：慢 ${formatPace(delta)} /km`;
            }
          }

          return `${point.axisValue}<br/>平均配速：${formatPace(point.data)} /km${
            deltaText ? `<br/>${deltaText}` : ""
          }`;
        }
      },
      grid: {
        top: 28,
        left: 56,
        right: 24,
        bottom: 36
      },
      xAxis: {
        type: "category",
        data: data.map((item) => `D${item.day}`),
        axisLine: { lineStyle: { color: theme.gridLineColor } },
        axisLabel: { color: theme.subTextColor }
      },
      yAxis: {
        type: "value",
        name: "配速 (/km，越小越好)",
        inverse: true,
        min: (value) => Math.floor((value.min - 8) / 10) * 10,
        max: (value) => Math.ceil((value.max + 8) / 10) * 10,
        nameTextStyle: { color: theme.subTextColor },
        axisLabel: {
          color: theme.subTextColor,
          formatter: (value) => formatPace(value)
        },
        splitLine: { lineStyle: { color: theme.splitLineColor } }
      },
      series: [
        {
          name: "平均配速",
          type: "line",
          smooth: true,
          symbolSize: 8,
          data: data.map((item) => item.paceSeconds)
        }
      ]
    };
  }

  function showChartError(root, message) {
    const errorEl = root.querySelector('[data-role="chart-error"]');
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.style.display = "block";
  }

  function hideChartError(root) {
    const errorEl = root.querySelector('[data-role="chart-error"]');
    if (!errorEl) return;
    errorEl.textContent = "";
    errorEl.style.display = "none";
  }

  function loadEcharts() {
    if (window.echarts) return Promise.resolve(window.echarts);
    if (window[ECHARTS_PROMISE_KEY]) return window[ECHARTS_PROMISE_KEY];

    const promise = new Promise((resolve, reject) => {
      let script = document.getElementById(ECHARTS_SCRIPT_ID);
      const createScript = !script;

      if (!script) {
        script = document.createElement("script");
        script.id = ECHARTS_SCRIPT_ID;
        script.src = ECHARTS_SRC;
        script.async = true;
      }

      const cleanup = () => {
        script.removeEventListener("load", onLoad);
        script.removeEventListener("error", onError);
      };

      const onLoad = () => {
        cleanup();
        script.dataset.loaded = "true";
        if (window.echarts) resolve(window.echarts);
        else reject(new Error("ECharts loaded but window.echarts not found."));
      };

      const onError = () => {
        cleanup();
        reject(new Error("Failed to load ECharts."));
      };

      if (script.dataset.loaded === "true" && window.echarts) {
        resolve(window.echarts);
        return;
      }

      script.addEventListener("load", onLoad);
      script.addEventListener("error", onError);

      if (createScript) {
        document.head.appendChild(script);
      }
    });

    window[ECHARTS_PROMISE_KEY] = promise
      .then((echarts) => {
        window[ECHARTS_PROMISE_KEY] = Promise.resolve(echarts);
        return echarts;
      })
      .catch((error) => {
        window[ECHARTS_PROMISE_KEY] = null;
        throw error;
      });

    return window[ECHARTS_PROMISE_KEY];
  }

  function renderCharts(state, data) {
    if (!window.echarts) return;

    const root = state.root;
    const mainChartEl = root.querySelector('[data-role="chart-main"]');
    const paceChartEl = root.querySelector('[data-role="chart-pace"]');
    const paceEmptyEl = root.querySelector('[data-role="pace-empty"]');

    if (!mainChartEl || !paceChartEl || !paceEmptyEl) return;

    const theme = getThemeTokens();
    hideChartError(root);

    if (!state.charts.main) {
      state.charts.main = window.echarts.init(mainChartEl);
    }
    state.charts.main.setOption(createMainChartOption(data, theme), true);

    const paceData = data.filter((item) => Number.isFinite(item.paceSeconds));
    if (paceData.length > 0) {
      paceChartEl.style.display = "block";
      paceEmptyEl.style.display = "none";
      if (!state.charts.pace) {
        state.charts.pace = window.echarts.init(paceChartEl);
      }
      state.charts.pace.setOption(createPaceChartOption(paceData, theme), true);
    } else {
      paceChartEl.style.display = "none";
      paceEmptyEl.style.display = "block";
      if (state.charts.pace) {
        state.charts.pace.dispose();
        state.charts.pace = null;
      }
    }
  }

  function initDashboard() {
    cleanupOldInstance();

    const root = document.getElementById(ROOT_ID);
    if (!root) return;

    const data = parseRunningData();
    const state = {
      root,
      data,
      charts: {
        main: null,
        pace: null
      },
      resizeHandler: null,
      themeObserver: null
    };

    window[STATE_KEY] = state;

    renderSummary(root, data);
    renderTable(root, data);

    if (!data.length) {
      showChartError(root, "暂无可视化数据：请先补充 Day 数据行。");
      return;
    }

    loadEcharts()
      .then(() => {
        renderCharts(state, data);

        state.resizeHandler = () => {
          if (state.charts.main) state.charts.main.resize();
          if (state.charts.pace) state.charts.pace.resize();
        };
        window.addEventListener("resize", state.resizeHandler);

        state.themeObserver = new MutationObserver((mutations) => {
          const changed = mutations.some((mutation) => mutation.attributeName === "data-theme");
          if (changed) {
            renderCharts(state, data);
          }
        });
        state.themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["data-theme"]
        });
      })
      .catch(() => {
        showChartError(root, "图表加载失败（ECharts CDN 不可用），统计表仍可正常使用。");
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDashboard, { once: true });
  } else {
    initDashboard();
  }
})();
