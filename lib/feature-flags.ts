function readBooleanFlag(value: string | undefined) {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

export const visitConversationRecordingEnabled = readBooleanFlag(
  process.env.NEXT_PUBLIC_VISIT_CONVERSATION_RECORDING_ENABLED,
);
