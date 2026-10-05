import { Link } from 'react-router-dom'
import { TopBar } from '../components/TopBar'
import { rise, useBack } from '../components/kit'
import { CONTACT } from '../account/contact'

/** When this policy last changed in substance. */
const UPDATED = '6 October 2026'

/**
 * The privacy policy for the Android app and manabind.com — the public URL Google Play asks for. It
 * says what the code does; when a release changes what leaves the device, this changes with it
 * (and so does the Play Data safety form, play-store/data-safety.md in the Android repo).
 */
export function PrivacyPage() {
  const back = useBack('/settings')
  return (
    <>
      <TopBar title="Privacy policy" onBack={back} />
      <div className="content-scroll rise" style={{ ...rise(0), paddingTop: 8 }}>
        <article className="narrow-width prose-page">
          <p className="dim">Last updated {UPDATED}. This covers the Manabind Android app and manabind.com.</p>

          <h2>The short version</h2>
          <ul>
            <li>Manabind works without an account. Without one, your decks, binders and settings stay on your device.</li>
            <li>With an account, your library and anything you do with friends is stored on Manabind's server so it can sync.</li>
            <li>No ads, no advertising trackers, and nothing is sold.</li>
            <li>You can delete your account and its data at any time: <Link to="/delete-account">Delete my account</Link>.</li>
          </ul>

          <h2>What stays on your device</h2>
          <p>
            Your decks, binders, wishlist, storage places, game history, price history and settings are kept on your phone (or in
            your browser's storage on manabind.com). Card scanning reads the card with your camera and recognises it on your
            device; camera pictures are not sent anywhere.
          </p>

          <h2>What we store if you make an account</h2>
          <p>Accounts and sync run on Supabase (our hosting provider). If you sign in we store:</p>
          <ul>
            <li><strong>Your email address and a password hash</strong>, to sign you in and to send confirmation and password-reset emails.</li>
            <li><strong>Your library</strong> — decks, binders, wishlist, storage places, loans and the names you type for guests and borrowers — so it syncs between your devices.</li>
            <li>
              <strong>If you use Friends:</strong> your username, display name and profile picture; your friends and pods; what you
              share and with whom; trades, trade messages and ratings; direct messages; games recorded for a pod; and blocks and
              reports you make. People only see what you share with them, and your friends see your profile. What you post
              there has to follow the <Link to="/community-rules">community rules</Link>; that you agreed to them is
              noted on your account.
            </li>
            <li><strong>If you turn on notifications:</strong> a push token for your phone (Firebase Cloud Messaging) or browser, so friend and trade notifications reach you.</li>
            <li><strong>If you approve a web sign-in with a QR code:</strong> a short-lived record of that sign-in and the browser's description of itself.</li>
          </ul>

          <h2>Anonymous usage counts</h2>
          <p>
            If a version of Manabind counts how often features are used, the counts are anonymous and only used to decide what to
            improve. They don't include your email, your library or what you search for.
          </p>

          <h2>Services the app talks to</h2>
          <p>
            To show cards, prices and suggestions, your device asks these services directly; they see the request (such as a card
            name or a search) and your IP address, as any website would: Scryfall (cards, images and prices), Commander Spellbook
            (combos), EDHREC (suggestions), MTGJSON (precon lists), Frankfurter (currency rates), Giphy (GIFs you choose), GitHub
            (app updates, for the version downloaded from GitHub), and Google (only if you import an old Google Drive backup).
            News headlines from MTG Arena Zone and Star City Games come through our own server. Links to TCGplayer open their
            website.
          </p>

          <h2>Tester app</h2>
          <p>
            The separate Manabind Tester app, used to try changes before release, can send bug and crash reports — with the
            screen, recent actions, device model and sometimes a screenshot — when a tester chooses to. The normal app does not.
          </p>

          <h2>Security</h2>
          <p>
            Everything is sent over encrypted connections (HTTPS). On the server, each person can only read their own data and
            what others have shared with them.
          </p>

          <h2>How long we keep it, and deleting it</h2>
          <p>
            We keep your account's data until you delete it. <Link to="/delete-account">Delete my account</Link> (or Settings ›
            Account &amp; sync › Delete my account in the app) removes your account, your synced library, your profile and picture,
            friends, shares, trades, messages, loans, pod games you recorded, push tokens and reports at once. Copies on your
            devices go when you sign out or uninstall. Server backups kept by our hosting provider expire on their own schedule.
          </p>

          <h2>Children</h2>
          <p>Manabind is not made for children under 13, and we don't knowingly hold their data.</p>

          <h2>Your rights</h2>
          <p>
            You can see your data in the app, export your decks and binders, correct it, and delete it as above. For anything
            else — including questions about this policy — contact us through <a href={CONTACT.href} target="_blank" rel="noreferrer">{CONTACT.label}</a>.
          </p>

          <p className="dim">
            Manabind is unofficial Fan Content permitted under the Fan Content Policy. Not approved or endorsed by Wizards.
            Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
          </p>
        </article>
      </div>
    </>
  )
}
