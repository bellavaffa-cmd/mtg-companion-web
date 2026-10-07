import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { NextGameNightCard } from './NextGameNightCard'
import { useNightsAvailable } from './nights'

/**
 * On a pod's page (PodGames.tsx): its next game night, Plan a game night and Pod chat. A temporary
 * way in until Friends' Chats tab and Play show them. Nothing before the server has invites.
 */
export function PodNightAndChat({ podId }: { podId: string }) {
  const navigate = useNavigate()
  const available = useNightsAvailable()
  if (!available) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
      <NextGameNightCard podId={podId} />
      <div className="chips">
        <button type="button" className="btn line sm" onClick={() => navigate(`/pods/${podId}/chat`)}><Icon name="forum" aria-hidden />Pod chat</button>
        <button type="button" className="btn line sm" onClick={() => navigate(`/play/nights/new?pod=${podId}`)}><Icon name="event" aria-hidden />Plan a game night</button>
      </div>
    </div>
  )
}
