import type { UserType } from '../../../../server/src/shared/databricks/auth/databricks-auth';
import type { ChatModel } from './models';

interface Entitlements {
  maxMessagesPerDay: number;
  availableChatModelIds: Array<ChatModel['id']>;
}

export const entitlementsByUserType: Record<UserType, Entitlements> = {
  /*
   * For regular users (Databricks authentication only)
   */
  regular: {
    maxMessagesPerDay: 10000,
    availableChatModelIds: ['chat-model', 'chat-model-reasoning'],
  },
};
