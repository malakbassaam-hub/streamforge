function copyOptions(options) {
  return options.map(({ label, count }) => ({ label, count }));
}

export class VoteInputError extends Error {}

export function createVoteManager(publish) {
  let activeVote;
  let timer;

  function publishUpdate() {
    publish({
      type: "vote.update",
      question: activeVote.question,
      options: copyOptions(activeVote.options),
      endsAt: activeVote.endsAt,
    });
  }

  function finishVote() {
    if (!activeVote) return;

    clearTimeout(timer);
    const finishedVote = activeVote;
    activeVote = undefined;
    const highestCount = Math.max(...finishedVote.options.map(({ count }) => count));
    const winningOptions = highestCount === 0
      ? []
      : finishedVote.options
          .filter(({ count }) => count === highestCount)
          .map(({ label }) => label);

    publish({
      type: "vote.result",
      winner: winningOptions.length === 0
        ? null
        : winningOptions.length === 1
          ? winningOptions[0]
          : winningOptions,
      options: copyOptions(finishedVote.options),
    });
  }

  function scheduleFinish() {
    const remaining = activeVote.endsAt - Date.now();
    if (remaining <= 0) {
      finishVote();
      return;
    }

    timer = setTimeout(scheduleFinish, Math.min(remaining, 2_147_483_647));
  }

  function castVote(user, optionNumber) {
    if (!activeVote || typeof user !== "string" || !user.trim()) return false;
    if (Date.now() >= activeVote.endsAt) {
      finishVote();
      return false;
    }
    if (!Number.isInteger(optionNumber) || optionNumber < 1 || optionNumber > activeVote.options.length) {
      return false;
    }

    const voter = user.trim().toLowerCase();
    const previousOption = activeVote.votes.get(voter);
    if (previousOption !== undefined) {
      if (previousOption === optionNumber) return false;
      activeVote.options[previousOption - 1].count -= 1;
    }

    activeVote.votes.set(voter, optionNumber);
    activeVote.options[optionNumber - 1].count += 1;
    publishUpdate();
    return true;
  }

  return {
    start(question, options, durationSeconds) {
      if (typeof question !== "string" || !question.trim() || question.length > 120) {
        throw new VoteInputError("Question must be a non-empty string of at most 120 characters.");
      }
      if (!Array.isArray(options) || options.length < 2 || options.length > 4) {
        throw new VoteInputError("Provide between 2 and 4 options.");
      }

      const labels = options.map((option) => {
        if (typeof option !== "string" || !option.trim() || option.length > 40) {
          throw new VoteInputError("Each option must be a non-empty string of at most 40 characters.");
        }
        return option.trim();
      });
      if (new Set(labels.map((label) => label.toLowerCase())).size !== labels.length) {
        throw new VoteInputError("Options must be unique.");
      }
      if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds < 10 || durationSeconds > 300) {
        throw new VoteInputError("Duration must be from 10 to 300 seconds.");
      }
      const endsAt = Date.now() + durationSeconds * 1000;
      if (!Number.isFinite(endsAt) || endsAt > 8_640_000_000_000_000) {
        throw new VoteInputError("Duration is too long.");
      }

      if (activeVote) finishVote();

      activeVote = {
        question: question.trim(),
        options: labels.map((label) => ({ label, count: 0 })),
        endsAt,
        votes: new Map(),
      };
      publishUpdate();
      scheduleFinish();
    },

    handleChatMessage(user, text) {
      if (typeof text !== "string") return false;
      const normalizedText = text
        .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
        .trim();
      const match = /^!([1-4])(?:\s|$)/i.exec(normalizedText);
      return match ? castVote(user, Number(match[1])) : false;
    },

    isOpen() {
      if (activeVote && Date.now() >= activeVote.endsAt) {
        finishVote();
      }
      return Boolean(activeVote);
    },
  };
}
