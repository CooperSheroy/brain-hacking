export const providerCatalog = [
  {
    id: "twitter",
    label: "Twitter/X",
    status: "foundation-ready",
    mode: "oauth-pkce",
    oauth: {
      authorizationUrl: "https://twitter.com/i/oauth2/authorize",
      clientIdPlaceholder: "TWITTER_CLIENT_ID"
    },
    defaultScopes: ["tweet.read", "users.read", "offline.access"],
    supportedSignals: ["follows", "likes", "bookmarks", "recent posts"],
    scopes: [
      {
        id: "tweet.read",
        label: "Read posts",
        risk: "low",
        reason: "Needed to classify topics and attention patterns from visible post activity."
      },
      {
        id: "users.read",
        label: "Read profile/follows",
        risk: "low",
        reason: "Needed to identify creator clusters and accounts shaping the feed."
      },
      {
        id: "offline.access",
        label: "Refresh access",
        risk: "medium",
        reason: "Needed only for scheduled imports after explicit user consent."
      }
    ]
  },
  {
    id: "instagram",
    label: "Instagram",
    status: "provider-planned",
    mode: "oauth-pkce",
    oauth: {
      authorizationUrl: "https://api.instagram.com/oauth/authorize",
      clientIdPlaceholder: "INSTAGRAM_CLIENT_ID"
    },
    defaultScopes: ["user_profile", "user_media"],
    supportedSignals: ["profile", "media captions", "creator clusters"],
    scopes: [
      {
        id: "user_profile",
        label: "Read profile",
        risk: "low",
        reason: "Needed to connect the account identity to imported signals."
      },
      {
        id: "user_media",
        label: "Read media",
        risk: "medium",
        reason: "Needed to infer topics from user-owned media and captions where available."
      }
    ]
  },
  {
    id: "facebook",
    label: "Facebook",
    status: "provider-planned",
    mode: "oauth-pkce",
    oauth: {
      authorizationUrl: "https://www.facebook.com/v20.0/dialog/oauth",
      clientIdPlaceholder: "FACEBOOK_CLIENT_ID"
    },
    defaultScopes: ["public_profile"],
    supportedSignals: ["profile", "page interests"],
    scopes: [
      {
        id: "public_profile",
        label: "Read public profile",
        risk: "low",
        reason: "Minimum connection scope before requesting any additional platform permissions."
      }
    ]
  },
  {
    id: "manual",
    label: "Manual import",
    status: "ready",
    mode: "local",
    defaultScopes: ["local.text"],
    supportedSignals: ["pasted topics", "export notes", "self-audits"],
    scopes: [
      {
        id: "local.text",
        label: "Local text only",
        risk: "low",
        reason: "Processes only text entered by the user in this browser session."
      }
    ]
  }
];

export function getProvider(providerId) {
  const provider = providerCatalog.find((item) => item.id === providerId);
  if (!provider) {
    throw new Error(`Unknown provider: ${providerId}`);
  }
  return provider;
}

export function getConnectableProviders() {
  return providerCatalog.filter((provider) => provider.mode === "oauth-pkce");
}
