import { createAddressLoader } from 'applesauce-loaders/loaders';
import { relayPool } from './relay-pool';
import { eventStore } from './eventStore';

// Address loader used to fetch profile metadata (and other addressable events)
export const addressLoader = createAddressLoader(relayPool, { eventStore });
