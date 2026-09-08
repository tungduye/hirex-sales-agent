import type { ChannelAdapter, ChannelType } from "./channel-contracts.ts";

export class ChannelAdapterRegistry {
  private readonly adapters = new Map<ChannelType, ChannelAdapter>();

  register(adapter: ChannelAdapter): void {
    if (this.adapters.has(adapter.channelType)) {
      throw new Error("CHANNEL_ADAPTER_ALREADY_REGISTERED");
    }

    this.adapters.set(adapter.channelType, adapter);
  }

  get(channelType: ChannelType): ChannelAdapter {
    const adapter = this.adapters.get(channelType);
    if (!adapter) throw new Error("CHANNEL_ADAPTER_UNAVAILABLE");
    return adapter;
  }

  has(channelType: ChannelType): boolean {
    return this.adapters.has(channelType);
  }
}
