import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

/**
 * Root HTML document for the web/PWA build (runs only in Node during static
 * export, never in the browser). Carries the PWA manifest and the iOS
 * "Add to Home Screen" meta so the deployed site installs as a standalone app
 * on iPhone — same Relay identity, no Safari chrome.
 *
 * Everything appearance-dependent here is only the *boot* value, read from the
 * OS via `prefers-color-scheme`: the root layout takes over the moment React
 * mounts and moves it to whatever the athlete pinned in Réglages.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* viewport-fit=cover lets the app draw under the notch; SafeAreaView
            handles the insets. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />

        <title>Relay</title>
        <meta
          name="description"
          content="Relay orchestre ta semaine : course, renfo et sports co comptent dans la même charge, et le plan s'ajuste à ta récupération réelle."
        />

        {/* Installable PWA */}
        <link rel="manifest" href="/manifest.json" />
        {/* Boot tint for the browser/OS chrome — one per appearance, then the
            root layout rewrites the first tag's content on every change. */}
        <meta name="theme-color" content="#F2EEE6" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#16181A" media="(prefers-color-scheme: dark)" />

        {/* iOS standalone home-screen app */}
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Relay" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <link rel="icon" type="image/png" href="/icons/favicon-32.png" />

        <ScrollViewStyleReset />

        {/* The ground is painted before React mounts, so there is no white flash
            on launch and no wrong-colour band when the standalone app
            rubber-bands past its content. `color-scheme` also hands the correct
            appearance to the UA's own surfaces (scrollbars, form controls). */}
        <style
          dangerouslySetInnerHTML={{
            __html: [
              'html,body,#root{background-color:#F2EEE6;}',
              'html{color-scheme:light;}',
              'body{overscroll-behavior-y:none;}',
              '@media (prefers-color-scheme: dark){',
              'html,body,#root{background-color:#16181A;}html{color-scheme:dark;}}',
            ].join(''),
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
