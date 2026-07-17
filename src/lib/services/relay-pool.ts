import { RelayPool } from 'applesauce-relay';

// Create a single relay pool instance for the entire application
export const relayPool = new RelayPool();

export const commonRelays = ['wss://relay.contextvm.org'];

export const metadataRelays = ['wss://purplepag.es/', 'wss://nos.lol', 'wss://relay.damus.io'];
