import * as blogger from './blogger.js';
import * as wordpress from './wordpress.js';
import * as webhook from './webhook.js';

export const publishers = { blogger, wordpress, webhook };

export function publisherFor(site) {
  const publisher = publishers[site.type];
  if (!publisher) throw new Error(`Tipe situs tidak dikenal: ${site.type}`);
  return publisher;
}
