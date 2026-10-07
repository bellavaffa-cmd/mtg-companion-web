/*
 * Places on the Friends and Play tabs kept for work that comes next. Each renders nothing yet; fill
 * the body here and every page that shows it picks it up. The Android app's twin is
 * ui/social/FriendsSlots.kt, with the same three names.
 */

import type { Overview } from './api'

/**
 * The next game night card: at the top of Friends › People and under Start a game on Play. Renders
 * nothing while there's no game night to show (and, for now, always). [onOpen] opens Game night.
 */
export function NextGameNightCard(_props: { onOpen: () => void }) {
  // Filled by the game night invites work: the date, who's going, and Going? / Open.
  return null
}

/**
 * Pod chats, at the top of Friends › Chats above the direct messages. Renders nothing for now.
 * [onOpenPod]: a pod's chat, by pod id.
 */
export function PodChats(_props: { overview: Overview; onOpenPod: (podId: string) => void }) {
  // Filled by the pod chat work.
  return null
}

/** New kinds of item at the top of Friends › Activity, above friends' feed. Renders nothing for now. */
export function ActivityExtras(_props: { overview: Overview }) {
  // Filled by the activity work (new items: invites, comments…).
  return null
}
