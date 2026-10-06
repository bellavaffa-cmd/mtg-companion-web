import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { SyncProvider } from './sync/SyncContext'
import { AccountDialogs } from './components/AccountDialogs'
import { CardHoverPreview } from './components/CardHoverPreview'
import { Layout } from './components/Layout'
import { UndoProvider } from './components/UndoBar'
import { AddCheckProvider } from './components/AddCheckDialog'
import { HomePage } from './pages/HomePage'
import { CollectionsPage } from './pages/CollectionsPage'
import { CollectionDetailPage } from './pages/CollectionDetailPage'
import { SetCardsPage } from './pages/SetCardsPage'
import { PlacePage } from './pages/PlacePage'
import { BinderFitPage } from './pages/BinderFitPage'
import { CheckResultsPage } from './pages/CheckResultsPage'
import { PlaceLabelPage, PlaceLinkPage } from './pages/PlaceLabelPage'
import { PullListPage } from './pages/PullListPage'
import { PutBackPage } from './pages/PutBackPage'
import { DeckHistoryPage, DeckVersionPage } from './pages/DeckHistoryPage'
import { LoansPage } from './pages/LoansPage'
import { LendPage } from './pages/LendPage'
import { CopyHistoryPage } from './pages/CopyHistoryPage'
import { ValueByPlacePage } from './pages/ValueByPlacePage'
import { SpacePage } from './pages/SpacePage'
import { StorageSetupPage } from './pages/StorageSetupPage'
import { UpkeepPage } from './pages/UpkeepPage'
import { SellPage } from './pages/SellPage'
import { CopyPhotoPage } from './pages/CopyPhotoPage'
import { DecksPage } from './pages/DecksPage'
import { PreconsPage } from './pages/PreconsPage'
import { NewDeckPage } from './pages/NewDeckPage'
import { DeckDetailPage } from './pages/DeckDetailPage'
import { SearchPage } from './pages/SearchPage'
import { CardPage } from './pages/CardPage'
import { AccountPage } from './pages/AccountPage'
import { SettingsPage, SettingsSectionPage } from './pages/SettingsPage'
import { LifeCounterPage } from './lifecounter/LifeCounterPage'
import { RemotePage } from './lifecounter/RemotePage'
import { PlayPage } from './lifecounter/PlayPage'
import { GameNightPage } from './lifecounter/GameNightPage'
import { GetAppPage } from './pages/GetAppPage'
import { ValueHistoryPage } from './pages/ValueHistoryPage'
import { SpreadThinPage } from './pages/SpreadThinPage'
import { PlaygroupPage } from './pages/PlaygroupPage'
import { TagBinderPage } from './collection/TagBinders'
import { RulesPage } from './pages/RulesPage'
import { ScanPage } from './pages/ScanPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { PrivacyPage } from './pages/PrivacyPage'
import { CommunityRulesHost, CommunityRulesPage } from './social/CommunityRules'
import { DeleteAccountPage } from './pages/DeleteAccountPage'
import { WelcomePage } from './onboarding/WelcomePage'
import { SocialProvider } from './social/SocialContext'
import './social/social.css'
import { UsageScreens } from './usage/UsageUi'

// Friends, sharing, trades and events load when first opened.
const HouseholdPage = lazy(() => import('./pages/HouseholdPage').then((m) => ({ default: m.HouseholdPage })))
const FriendsPage = lazy(() => import('./pages/FriendsPage').then((m) => ({ default: m.FriendsPage })))
const FriendPage = lazy(() => import('./pages/FriendPage').then((m) => ({ default: m.FriendPage })))
const SharedItemPage = lazy(() => import('./pages/SharedItemPage').then((m) => ({ default: m.SharedItemPage })))
const FriendSharedPage = lazy(() => import('./social/SharedFriends').then((m) => ({ default: m.FriendSharedPage })))
const SharedCollectionPage = lazy(() => import('./pages/SharedItemPage').then((m) => ({ default: m.SharedCollectionPage })))
const TradesPage = lazy(() => import('./pages/TradesPage').then((m) => ({ default: m.TradesPage })))
const TradeComposerPage = lazy(() => import('./pages/TradeComposerPage').then((m) => ({ default: m.TradeComposerPage })))
const PageScanPage = lazy(() => import('./pages/PageScanPage').then((m) => ({ default: m.PageScanPage })))
const MessagesPage = lazy(() => import('./pages/MessagesPage').then((m) => ({ default: m.MessagesPage })))
const ConversationPage = lazy(() => import('./pages/MessagesPage').then((m) => ({ default: m.ConversationPage })))
const ForTradePage = lazy(() => import('./pages/ForTradePage').then((m) => ({ default: m.ForTradePage })))
const AddFriendLinkPage = lazy(() => import('./pages/LinkPages').then((m) => ({ default: m.AddFriendLinkPage })))
const EventsPage = lazy(() => import('./tournament/EventPages').then((m) => ({ default: m.EventsPage })))
const NewEventPage = lazy(() => import('./tournament/EventPages').then((m) => ({ default: m.NewEventPage })))
const EventPage = lazy(() => import('./tournament/EventPages').then((m) => ({ default: m.EventPage })))
const JoinSeatPage = lazy(() => import('./pages/LinkPages').then((m) => ({ default: m.JoinSeatPage })))
const ApproveLoginPage = lazy(() => import('./pages/LinkPages').then((m) => ({ default: m.ApproveLoginPage })))

export default function App() {
  return (
    <SyncProvider>
      <SocialProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        {/* Anonymous counts of the screens opened (Settings › Privacy). */}
        <UsageScreens />
        {/* The one-time community rules, asked for before a first post (profile, message, trade, share). */}
        <CommunityRulesHost />
        {/* The Undo bar after a card goes into a deck or binder, on every screen. */}
        <UndoProvider>
        {/* The check before a card goes into a deck, asked wherever it's added from. */}
        <AddCheckProvider>
        <Suspense fallback={null}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/collections" element={<CollectionsPage />} />
            <Route path="/collections/:id" element={<CollectionDetailPage />} />
            <Route path="/collections/tag/:tagId" element={<TagBinderPage />} />
            <Route path="/collections/set/:code" element={<SetCardsPage />} />
            <Route path="/collections/place/:id" element={<PlacePage />} />
            <Route path="/collections/place/:id/label" element={<PlaceLabelPage />} />
            <Route path="/collections/place/:id/fit" element={<BinderFitPage />} />
            <Route path="/collections/place/:id/scan-page" element={<PageScanPage />} />
            <Route path="/collections/place/:id/check" element={<CheckResultsPage />} />
            <Route path="/collections/labels" element={<PlaceLabelPage />} />
            <Route path="/collections/value" element={<ValueByPlacePage />} />
            <Route path="/collections/space" element={<SpacePage />} />
            <Route path="/collections/setup" element={<StorageSetupPage />} />
            <Route path="/collections/upkeep" element={<UpkeepPage />} />
            <Route path="/collections/sell" element={<SellPage />} />
            <Route path="/collections/photos" element={<CopyPhotoPage />} />
            <Route path="/collections/household" element={<HouseholdPage />} />
            <Route path="/collections/household/:id" element={<HouseholdPage />} />
            <Route path="/loans" element={<LoansPage />} />
            <Route path="/loans/lend" element={<LendPage />} />
            <Route path="/history" element={<CopyHistoryPage />} />
            <Route path="/place/:id" element={<PlaceLinkPage />} />
            <Route path="/collections/thin" element={<SpreadThinPage />} />
            <Route path="/decks" element={<DecksPage />} />
            <Route path="/decks/new" element={<NewDeckPage />} />
            <Route path="/decks/:id" element={<DeckDetailPage />} />
            <Route path="/decks/:id/pull" element={<PullListPage />} />
            <Route path="/decks/:id/put-back" element={<PutBackPage />} />
            <Route path="/decks/:id/history" element={<DeckHistoryPage />} />
            <Route path="/decks/:id/history/:entry" element={<DeckVersionPage />} />
            <Route path="/precons" element={<PreconsPage />} />
            <Route path="/rules" element={<RulesPage />} />
            <Route path="/play" element={<PlayPage />} />
            <Route path="/play/playgroup" element={<PlaygroupPage />} />
            <Route path="/play/events" element={<EventsPage />} />
            <Route path="/play/events/new" element={<NewEventPage />} />
            <Route path="/play/events/:id" element={<EventPage />} />
            <Route path="/play/night" element={<GameNightPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/card/:name" element={<CardPage />} />
            <Route path="/scan" element={<ScanPage />} />
            <Route path="/account" element={<AccountPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/:section" element={<SettingsSectionPage />} />
            <Route path="/friends" element={<FriendsPage />} />
            <Route path="/friends/:id" element={<FriendPage />} />
            <Route path="/trades" element={<TradesPage />} />
            <Route path="/trades/new" element={<TradeComposerPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/messages/:id" element={<ConversationPage />} />
            <Route path="/for-trade" element={<ForTradePage />} />
            <Route path="/shared/:owner" element={<FriendSharedPage />} />
            <Route path="/shared/:owner/collection" element={<SharedCollectionPage />} />
            <Route path="/shared/:owner/:kind/:itemId" element={<SharedItemPage />} />
            <Route path="/s/:token" element={<SharedItemPage />} />
            <Route path="/add/:username" element={<AddFriendLinkPage />} />
            <Route path="/login/:code" element={<ApproveLoginPage />} />
            <Route path="/join/:code/:seat" element={<JoinSeatPage />} />
            <Route path="/app" element={<GetAppPage />} />
            <Route path="/welcome" element={<WelcomePage />} />
            <Route path="/value" element={<ValueHistoryPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/community-rules" element={<CommunityRulesPage />} />
            <Route path="/delete-account" element={<DeleteAccountPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
          {/* The table runs edge to edge, without the app's navigation. */}
          <Route path="/life" element={<LifeCounterPage />} />
          <Route path="/remote/:matchId/:seat" element={<RemotePage />} />
        </Routes>
        </Suspense>
        </AddCheckProvider>
        </UndoProvider>
      </BrowserRouter>
      </SocialProvider>
      <AccountDialogs />
      <CardHoverPreview />
    </SyncProvider>
  )
}
