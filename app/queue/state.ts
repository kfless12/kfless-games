export type QueueActionState = { error: string | null; notice: string | null };

export const emptyQueueState: QueueActionState = { error: null, notice: null };
