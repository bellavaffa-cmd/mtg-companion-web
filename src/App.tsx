import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { SyncProvider } from './sync/SyncContext'
import { AccountDialogs } from './components/AccountDialogs'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { CollectionsPage } from './pages/CollectionsPage'
import { CollectionDetailPage } from './pages/CollectionDetailPage'
import { DecksPage } from './pages/DecksPage'
import { PreconsPage } from './pages/PreconsPage'
import { DeckDetailPage } from './pages/DeckDetailPage'
import { SearchPage } from './pages/SearchPage'
import { AccountPage } from './pages/AccountPage'
import { LifeCounterPage } from './lifecounter/LifeCounterPage'
import { RemotePage } from './lifecounter/RemotePage'
import { RulesPage } from './pages/RulesPage'
import { ScanPage } from './pages/ScanPage'
import { SocialProvider } from './social/SocialContext'
import './social/social.css'

// Friends, sharing and trades load when first opened.
const FriendsPage = lazy(() => import('./pages/FriendsPage').then((m) => ({ default: m.FriendsPage })))
const FriendPage = lazy(() => import('./pages/FriendPage').then((m) => ({ default: m.FriendPage })))
const SharedItemPage = lazy(() => import('./pages/SharedItemPage').then((m) => ({ default: m.SharedItemPage })))
const FriendSharedPage = lazy(() => import('./social/SharedFriends').then((m) => ({ default: m.FriendSharedPage })))
const SharedCollectionPage = lazy(() => import('./pages/SharedItemPage').then((m) => ({ default: m.SharedCollectionPage })))
const TradesPage = lazy(() => import('./pages/TradesPage').then((m) => ({ default: m.TradesPage })))
const TradeComposerPage = lazy(() => import('./pages/TradeComposerPage').then((m) => ({ default: m.TradeComposerPage })))
const AddFriendLinkPage = lazy(() => import('./pages/LinkPages').then((m) => ({ default: m.AddFriendLinkPage })))
const JoinSeatPage = lazy(() => import('./pages/LinkPages').then((m) => ({ default: m.JoinSeatPage })))

export default function App() {
  return (
    <SyncProvider>
      <SocialProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Suspense fallback={null}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/collections" element={<CollectionsPage />} />
            <Route path="/collections/:id" element={<CollectionDetailPage />} />
            <Route path="/decks" element={<DecksPage />} />
            <Route path="/decks/:id" element={<DeckDetailPage />} />
            <Route path="/precons" element={<PreconsPage />} />
            <Route path="/rules" element={<RulesPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/scan" element={<ScanPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/friends" element={<FriendsPage />} />
            <Route path="/friends/:id" element={<FriendPage />} />
            <Route path="/trades" element={<TradesPage />} />
            <Route path="/trades/new" element={<TradeComposerPage />} />
            <Route path="/shared/:owner" element={<FriendSharedPage />} />
            <Route path="/shared/:owner/collection" element={<SharedCollectionPage />} />
            <Route path="/shared/:owner/:kind/:itemId" element={<SharedItemPage />} />
            <Route path="/s/:token" element={<SharedItemPage />} />
            <Route path="/add/:username" element={<AddFriendLinkPage />} />
            <Route path="/join/:code/:seat" element={<JoinSeatPage />} />
          </Route>
          {/* The table runs edge to edge, without the app's navigation. */}
          <Route path="/life" element={<LifeCounterPage />} />
          <Route path="/remote/:matchId/:seat" element={<RemotePage />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
      </SocialProvider>
      <AccountDialogs />
    </SyncProvider>
  )
}
