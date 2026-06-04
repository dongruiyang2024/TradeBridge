import type { WebliteData } from "@wangwang/onetalk-adapter/browser";
import {
  contactProfileRequestsFromConversations,
  requestOneTalkCustomerProfiles
} from "./onetalk-customer-profile-client.js";
import { requestOneTalkConversations } from "./onetalk-conversation-client.js";
import type { ChromeApi } from "../shared/chrome-api.js";

// Builds the conversation/customer-profile half of a sync batch from the page
// SDK (no LWP socket, no token). Message bodies are supplied separately from
// the passive page-socket tap buffer.
export interface OneTalkPageWebliteSourceOptions {
  chromeApi: ChromeApi;
  cursor?: () => number;
  count?: number;
}

export class OneTalkPageWebliteSource {
  constructor(private readonly options: OneTalkPageWebliteSourceOptions) {}

  async fetchWeblite(): Promise<WebliteData> {
    const cursor = this.options.cursor?.() ?? Date.now();
    const count = this.options.count ?? 100;
    const page = await requestOneTalkConversations({ chromeApi: this.options.chromeApi, cursor, count });
    const customerProfiles = await this.fetchCustomerProfiles(page.conversations);
    return {
      html: "",
      bootstrap: {},
      conversations: page.conversations,
      customerProfiles
    };
  }

  private async fetchCustomerProfiles(
    conversations: Record<string, unknown>[]
  ): Promise<Record<string, unknown>[] | undefined> {
    try {
      const profiles = await requestOneTalkCustomerProfiles({
        chromeApi: this.options.chromeApi,
        contacts: contactProfileRequestsFromConversations(conversations)
      });
      return profiles.length ? profiles : undefined;
    } catch {
      return undefined;
    }
  }
}
