export type Positioned<T> = T & { column: number; columnCount: number };

// Calendar-style overlap layout for one day's sessions: sessions that overlap
// in time (directly, or transitively through a chain of overlaps) share a
// cluster and split its width into equal columns — no attempt at the fancier
// "widen if nothing's to your right" layout real calendars do, since the spec
// only asks for equal-width side-by-side columns.
export function layoutDay<T extends { startMinutes: number; endMinutes: number }>(
  items: T[],
): Positioned<T>[] {
  const sorted = [...items].sort(
    (a, b) => a.startMinutes - b.startMinutes || a.endMinutes - b.endMinutes,
  );

  const result: Positioned<T>[] = [];
  let cluster: Positioned<T>[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;
  let columnEnds: number[] = [];

  const flushCluster = () => {
    const columnCount = columnEnds.length;
    for (const item of cluster) item.columnCount = columnCount;
    result.push(...cluster);
    cluster = [];
    columnEnds = [];
  };

  for (const item of sorted) {
    if (item.startMinutes >= clusterEnd) {
      flushCluster();
      clusterEnd = Number.NEGATIVE_INFINITY;
    }

    let column = columnEnds.findIndex((end) => end <= item.startMinutes);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(item.endMinutes);
    } else {
      columnEnds[column] = item.endMinutes;
    }

    cluster.push({ ...item, column, columnCount: 0 });
    clusterEnd = Math.max(clusterEnd, item.endMinutes);
  }
  flushCluster();

  return result;
}
