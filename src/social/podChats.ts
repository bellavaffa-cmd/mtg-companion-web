// Every pod's chat for Friends › Chats, where MessagesPage.tsx's ConversationList merges them with
// the direct messages (PodChatPage.tsx's PodChatRow draws each). The Android app's
// rememberPodChats in ui/social/PodChatScreen.kt.

import { useCallback, useEffect, useState } from 'react'
import { useSocial } from './SocialContext'
import { podChats, useNightsAvailable, usePodLive } from './nights'
import { totalUnread, type PodChat } from './nightsLogic'

/**
 * Every pod's chat for the Chats list (MessagesPage.tsx's ConversationList, merged with the direct
 * messages by mergeChatRows): null until loaded, empty until the server has pod chat. Reloads as
 * messages arrive, and tells the Friends badge how many wait unread (SocialContext's podUnread).
 */
export function usePodChats(enabled = true): PodChat[] | null {
  const available = useNightsAvailable()
  const { setPodUnread } = useSocial()
  const [chats, setChats] = useState<PodChat[] | null>(null)
  const load = useCallback(() => {
    podChats().then((c) => { setChats(c); setPodUnread(totalUnread(c)) }).catch(() => {})
  }, [setPodUnread])
  useEffect(() => { if (available && enabled) load() }, [available, enabled, load])
  usePodLive({ onMessage: load, onReconnect: load }, !!available && enabled)
  if (!enabled || available === false) return []
  return chats
}
