/**
 * TEMPORARY — SPEC.md §16, the Cloudflare Workers demo.
 *
 * No incremental cache is configured, and that is deliberate rather than an
 * omission: every route in this app is `force-dynamic` because standings, the
 * queue and the draft are all derived at read time (CLAUDE.md invariant 1), so
 * there is nothing for an ISR cache to hold. Skipping it means the demo needs
 * no R2 bucket.
 */
import { defineCloudflareConfig } from '@opennextjs/cloudflare';

export default defineCloudflareConfig();
