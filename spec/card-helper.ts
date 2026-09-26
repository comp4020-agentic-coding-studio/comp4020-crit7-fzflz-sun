// Parses session cards out of rendered timetable HTML by their visible
// content (course code, activity type, start time) rather than a numeric id
// — ids shift whenever the seed catalog changes, but "COMP1010 Tutorial at
// 10:00" is a stable fixture to write a test against.
export type CardInfo = {
  id: number;
  courseCode: string;
  activityType: string;
  time: string;
  status: "allocated" | "available" | "full";
};

export function parseCards(html: string): CardInfo[] {
  const cards: CardInfo[] = [];
  for (const match of html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)) {
    const block = match[0];
    if (!block.includes("data-session-id")) continue;
    const id = Number(block.match(/data-session-id="(\d+)"/)?.[1]);
    const status = block.match(/status-(allocated|available|full)/)?.[1] as
      | CardInfo["status"]
      | undefined;
    const courseCode = block.match(/class="card-course">([^<]+)</)?.[1];
    const activityType = block.match(/class="card-activity">([^<]+)</)?.[1];
    const time = block.match(/class="card-time">\s*([\s\S]*?)\s*<\/span>/)?.[1];
    if (!id || !status || !courseCode || !activityType || !time) continue;
    cards.push({ id, status, courseCode, activityType, time: time.trim() });
  }
  return cards;
}

export function findCard(
  cards: CardInfo[],
  courseCode: string,
  activityType: string,
  startTime: string,
): CardInfo {
  const card = cards.find(
    (c) =>
      c.courseCode === courseCode &&
      c.activityType === activityType &&
      c.time.startsWith(startTime),
  );
  if (!card) {
    throw new Error(`no card found for ${courseCode} ${activityType} starting ${startTime}`);
  }
  return card;
}

export function hasCard(
  cards: CardInfo[],
  courseCode: string,
  activityType: string,
  startTime: string,
): boolean {
  return cards.some(
    (c) =>
      c.courseCode === courseCode &&
      c.activityType === activityType &&
      c.time.startsWith(startTime),
  );
}

export function cardMarkup(html: string, sessionId: number): string {
  const marker = `data-session-id="${sessionId}"`;
  const start = html.indexOf(marker);
  if (start === -1) throw new Error(`no card for session ${sessionId}`);
  const cardStart = html.lastIndexOf("<button", start);
  const cardEnd = html.indexOf("</button>", start) + "</button>".length;
  return html.slice(cardStart, cardEnd);
}
