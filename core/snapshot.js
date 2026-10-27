export function createSnapshotStore() {
  let vote = null;
  const chat = [];
  let live = false;
  let demo = false;

  return {
    record(event) {
      if (event.type === "chat.message") {
        chat.push({ type: event.type, user: event.user, text: event.text, ts: event.ts });
        if (chat.length > 5) chat.shift();
      } else if (event.type === "vote.update") {
        vote = { ...event, startedAt: vote?.endsAt === event.endsAt ? vote.startedAt : Date.now() };
      } else if (event.type === "vote.result") {
        vote = { ...vote, ...event, hideAt: Date.now() + 8000 };
      }
    },
    setStatus(status) {
      if (typeof status.live === "boolean") live = status.live;
      if (typeof status.demo === "boolean") demo = status.demo;
      return { type: "status", live, demo };
    },
    getSnapshot() {
      const visibleVote = vote?.type === "vote.result" && Date.now() >= vote.hideAt ? null : vote;
      return structuredClone({ type: "snapshot", vote: visibleVote, chat, status: { live, demo } });
    },
  };
}
