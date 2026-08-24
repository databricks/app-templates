import { expect, test } from '@playwright/test';
import { canSubmitFeedback } from '../../server/src/lib/feedback-ownership';

test.describe('feedback ownership', () => {
  test('public visibility does not grant feedback mutation access', () => {
    expect(
      canSubmitFeedback({
        actorId: 'babbage-id',
        ownerId: 'ada-id',
        visibility: 'public',
      }),
    ).toBe(false);
    expect(
      canSubmitFeedback({
        actorId: 'ada-id',
        ownerId: 'ada-id',
        visibility: 'public',
      }),
    ).toBe(true);
  });
});
