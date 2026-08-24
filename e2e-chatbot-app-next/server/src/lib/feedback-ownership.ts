type FeedbackOwnership = {
  actorId: string;
  ownerId?: string;
  visibility?: 'public' | 'private';
};

export function canSubmitFeedback({
  actorId,
  ownerId,
}: FeedbackOwnership): boolean {
  return ownerId !== undefined && ownerId === actorId;
}
