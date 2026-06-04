const DAY_MS = 24 * 60 * 60 * 1000;
const CHART_WIDTH = 320;
const CHART_HEIGHT = 170;
const CHART_LEFT = 44;
const CHART_RIGHT = 18;
const CHART_TOP = 20;
const CHART_BOTTOM = 30;

function getTrendNumber(value) {
  if (value == null || String(value).trim() === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseDate(value) {
  const normalized = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return NaN;
  }
  return Date.parse(`${normalized}T00:00:00.000Z`);
}

function areAdjacentDates(left, right) {
  const leftTime = parseDate(left);
  const rightTime = parseDate(right);
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && rightTime - leftTime === DAY_MS;
}

function buildValueDomain(values) {
  const finiteValues = values.filter((value) => Number.isFinite(value));
  if (!finiteValues.length) {
    return { min: 0, max: 1, step: 1 };
  }
  const minValue = Math.min(...finiteValues);
  const maxValue = Math.max(...finiteValues);
  const spread = maxValue - minValue;
  const padding = spread === 0 ? Math.max(Math.abs(maxValue) * 0.001, 1) : spread * 0.15;
  const paddedMin = Math.min(0, minValue) < 0 ? minValue - padding : Math.max(0, minValue - padding);
  const paddedMax = maxValue + padding;
  const rawStep = (paddedMax - paddedMin || 1) / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalizedStep = rawStep / magnitude;
  const stepMultiplier = normalizedStep <= 1 ? 1 : normalizedStep <= 2 ? 2 : normalizedStep <= 5 ? 5 : 10;
  const step = stepMultiplier * magnitude;
  let min = Math.floor(paddedMin / step) * step;
  let max = Math.ceil(paddedMax / step) * step;
  if (min === max) {
    max = min + step;
  }
  return {
    min: Number(min.toFixed(4)),
    max: Number(max.toFixed(4)),
    step,
  };
}

function buildTicks(domain) {
  const ticks = [];
  const step = domain.step || 1;
  for (let value = domain.min; value <= domain.max + step / 1000; value += step) {
    ticks.push(Number(value.toFixed(4)));
  }
  if (ticks.at(-1) !== domain.max) {
    ticks.push(domain.max);
  }
  return ticks;
}

function getPointPosition(point, index, points, domain) {
  const x = points.length <= 1
    ? CHART_WIDTH / 2
    : CHART_LEFT + (index / (points.length - 1)) * (CHART_WIDTH - CHART_LEFT - CHART_RIGHT);
  const range = domain.max - domain.min || 1;
  const y = CHART_TOP + (1 - (Number(point.axisValue) - domain.min) / range) * (CHART_HEIGHT - CHART_TOP - CHART_BOTTOM);
  return { x, y };
}

function clampY(value) {
  return Math.min(144, Math.max(18, value));
}

function clampX(value) {
  return Math.min(304, Math.max(42, value));
}

function offsetPositions(positions, offset) {
  if (!offset || positions.length < 2) {
    return positions;
  }
  const first = positions[0];
  const last = positions.at(-1);
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const length = Math.hypot(dx, dy) || 1;
  const normalX = -dy / length;
  const normalY = dx / length;
  return positions.map((point) => ({
    ...point,
    x: clampX(point.x + normalX * offset),
    y: clampY(point.y + normalY * offset),
  }));
}

export function buildTrendValuePoints(metric) {
  const history = Array.isArray(metric?.history) ? metric.history : [];
  return history.filter((point) => !point?.isPreWindow).map((point) => {
    const value = getTrendNumber(point.value);
    return {
      ...point,
      axisValue: value,
      displayValue: value,
    };
  });
}

export function buildTrendDeltaPoints(metric) {
  const history = Array.isArray(metric?.history) ? metric.history : [];
  let previousPoint = null;
  const points = [];
  history.forEach((point) => {
    const value = getTrendNumber(point.value);
    const previousValue = getTrendNumber(previousPoint?.value);
    const canCompare =
      value != null &&
      previousValue != null &&
      areAdjacentDates(previousPoint?.date, point?.date);
    const axisValue = canCompare ? value - previousValue : null;
    previousPoint = point;
    if (!point?.isPreWindow) {
      points.push({
        ...point,
        axisValue,
        displayValue: axisValue,
      });
    }
  });
  return points;
}

export function filterNonZeroTrendMetrics(metrics) {
  return (Array.isArray(metrics) ? metrics : []).filter((metric) => {
    const values = (Array.isArray(metric?.history) ? metric.history : [])
      .filter((point) => !point?.isPreWindow)
      .map((point) => getTrendNumber(point.value))
      .filter((value) => value != null);
    return !values.length || values.some((value) => value !== 0);
  });
}

export function getTrendAxisLabelMarkers(markers, windowKey) {
  const visibleMarkers = (Array.isArray(markers) ? markers : []).filter(
    (entry) => entry?.point && !entry?.point?.isPreWindow && entry?.position
  );
  const lastIndex = visibleMarkers.length - 1;
  if (lastIndex < 0) {
    return [];
  }
  if (windowKey === "30d") {
    return visibleMarkers.filter((entry, index) => index % 5 === 0 || index === lastIndex);
  }
  if (windowKey === "7d") {
    return visibleMarkers.filter((entry, index) => index % 2 === 0 || index === lastIndex);
  }
  return visibleMarkers;
}

function splitSegments(entries) {
  const segments = [];
  let current = [];
  entries.forEach((entry) => {
    if (getTrendNumber(entry.point.axisValue) == null || !entry.position) {
      if (current.length > 1) {
        segments.push(current);
      }
      current = [];
      return;
    }
    current.push(entry);
  });
  if (current.length > 1) {
    segments.push(current);
  }
  return segments;
}

function buildLine(metric, axis, chartMode) {
  const pointBuilder = chartMode === "increment" ? buildTrendDeltaPoints : buildTrendValuePoints;
  const points = pointBuilder(metric);
  const validPointCount = points.filter((point) => getTrendNumber(point.axisValue) != null).length;
  if (validPointCount < 2) {
    return null;
  }

  const positionedEntries = points.map((point, index) => ({
    point,
    position: getTrendNumber(point.axisValue) == null
      ? null
      : getPointPosition(point, index, points, axis.domain),
  }));
  const segments = splitSegments(positionedEntries);
  const markers = positionedEntries.filter((entry) => entry.position);
  return {
    metric,
    axisSide: axis.side,
    points,
    positions: positionedEntries.map((entry) => entry.position).filter(Boolean),
    segments,
    markers,
  };
}

function buildAxis(metrics, chartMode) {
  const pointBuilder = chartMode === "increment" ? buildTrendDeltaPoints : buildTrendValuePoints;
  const values = metrics
    .flatMap((metric) => pointBuilder(metric))
    .map((point) => point.axisValue)
    .filter((value) => Number.isFinite(value));
  const domain = buildValueDomain(values);
  return {
    side: "left",
    unit: metrics[0]?.label || "数值",
    domain,
    ticks: buildTicks(domain),
  };
}

export function buildTrendChartLines(metrics, { chartMode = "absolute" } = {}) {
  const availableMetrics = Array.isArray(metrics) ? metrics : [];
  const axis = buildAxis(availableMetrics, chartMode);
  const axes = {
    left: axis,
  };
  const signatureCounts = new Map();
  const lines = availableMetrics
    .map((metric) => {
      const line = buildLine(metric, axis, chartMode);
      if (!line) {
        return null;
      }

      const renderedEntries = line.segments.flatMap((segment) => segment);
      const signature = renderedEntries
        .map(({ position }) => position)
        .map((point) => `${Math.round(point.x)}:${Math.round(point.y)}`)
        .join("|");
      const seenCount = signatureCounts.get(signature) || 0;
      signatureCounts.set(signature, seenCount + 1);
      const positions = offsetPositions(
        renderedEntries.map(({ position }) => position),
        seenCount * 8
      );
      const positionByDate = new Map(
        renderedEntries.map(({ point }, index) => [String(point?.date ?? ""), positions[index]])
      );
      const markerPositionByDate = new Map(
        line.markers.map(({ point, position }) => [String(point?.date ?? ""), position])
      );
      return {
        ...line,
        positions,
        segments: line.segments
          .map((segment) =>
            segment
              .map(({ point }) => ({
                point,
                position: positionByDate.get(String(point?.date ?? "")),
              }))
              .filter((segmentPoint) => segmentPoint.position)
          )
          .filter((segment) => segment.length > 1),
        markers: line.markers.map(({ point }) => ({
          point,
          position: positionByDate.get(String(point?.date ?? "")) || markerPositionByDate.get(String(point?.date ?? "")),
        })).filter((marker) => marker.position),
      };
    })
    .filter(Boolean);

  return {
    lines,
    axis,
    axes,
    chartMode,
  };
}

export function getTrendAxisY(value, domain) {
  const range = domain.max - domain.min || 1;
  return CHART_TOP + (1 - (value - domain.min) / range) * (CHART_HEIGHT - CHART_TOP - CHART_BOTTOM);
}
