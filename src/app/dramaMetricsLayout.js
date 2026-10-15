// Balance the fewest possible rows, sharing column minima across all rows.
// A long value can claim extra width without forcing every other column to match it.
export function getDramaMetricsGridColumns(metricWidths, availableWidth, gap = 16) {
  if (!metricWidths.length) return [];
  for (let rows = 1; rows <= metricWidths.length; rows += 1) {
    const columnCount = Math.ceil(metricWidths.length / rows);
    const columns = Array.from({ length: columnCount }, () => 0);
    metricWidths.forEach((width, index) => {
      columns[index % columnCount] = Math.max(columns[index % columnCount], Math.ceil(width));
    });
    const requiredWidth = columns.reduce((total, width) => total + width, 0) + gap * (columnCount - 1);
    if (requiredWidth <= availableWidth || columnCount === 1) return columns;
  }
  return [];
}
