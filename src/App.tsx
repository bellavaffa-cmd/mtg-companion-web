import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { SyncProvider } from './sync/SyncContext'
import { AccountDialogs } from './components/AccountDialogs'
import { Layout } from './components/Layout'
import { HomePage } from './pages/HomePage'
import { CollectionsPage } from './pages/CollectionsPage'
import { CollectionDetailPage } from './pages/CollectionDetailPage'
import { DecksPage } from './pages/DecksPage'
import { DeckDetailPage } from './pages/DeckDetailPage'
import { SearchPage } from './pages/SearchPage'
import { AccountPage } from './pages/AccountPage'
import { LifeCounterPage } from './lifecounter/LifeCounterPage'

export default function App() {
  return (
    <SyncProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/collections" element={<CollectionsPage />} />
            <Route path="/collections/:id" element={<CollectionDetailPage />} />
            <Route path="/decks" element={<DecksPage />} />
            <Route path="/decks/:id" element={<DeckDetailPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/account" element={<AccountPage />} />
          </Route>
          {/* The table runs edge to edge, without the app's navigation. */}
          <Route path="/life" element={<LifeCounterPage />} />
        </Routes>
      </BrowserRouter>
      <AccountDialogs />
    </SyncProvider>
  )
}
