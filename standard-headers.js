// Curated list of HTTP *request* headers for the Manual tab's autocomplete.
// Each entry: { name, example } and optionally { note } for headers the browser
// commonly controls itself and may ignore even from an extension.
//
// This is a convenience list, not a guarantee — declarativeNetRequest can set
// more than page JS can, but the browser still owns a few (Host, Content-Length,
// Connection, some Sec-*). Those carry a `note` shown in the datalist.
//
// Grouped only for readability here; the UI shows one flat, searchable list.

export const STANDARD_HEADERS = [
  // Content negotiation
  { name: "Accept", example: "application/json" },
  { name: "Accept-Encoding", example: "gzip, deflate, br" },
  { name: "Accept-Language", example: "en-US,en;q=0.9" },
  { name: "Accept-Charset", example: "utf-8" },

  // Authentication
  { name: "Authorization", example: "Bearer <token>" },
  { name: "Proxy-Authorization", example: "Basic <credentials>" },
  { name: "Cookie", example: "name=value" },

  // Caching / conditional
  { name: "Cache-Control", example: "no-cache" },
  { name: "Pragma", example: "no-cache" },
  { name: "If-Match", example: '"<etag>"' },
  { name: "If-None-Match", example: '"<etag>"' },
  { name: "If-Modified-Since", example: "Wed, 21 Oct 2015 07:28:00 GMT" },
  { name: "If-Unmodified-Since", example: "Wed, 21 Oct 2015 07:28:00 GMT" },
  { name: "If-Range", example: '"<etag>"' },

  // Context / identity
  { name: "User-Agent", example: "Mozilla/5.0" },
  { name: "Referer", example: "https://example.com" },
  { name: "Origin", example: "https://example.com" },
  { name: "From", example: "user@example.com" },
  { name: "Host", example: "example.com", note: "usually set by the browser" },

  // Content description
  { name: "Content-Type", example: "application/json" },
  { name: "Content-Length", example: "1024", note: "usually set by the browser" },
  { name: "Content-Encoding", example: "gzip" },
  { name: "Content-Language", example: "en-US" },
  { name: "Content-Disposition", example: "inline" },

  // Range
  { name: "Range", example: "bytes=0-1023" },

  // Client hints
  { name: "Sec-CH-UA", example: '"Chromium";v="124"', note: "usually set by the browser" },
  { name: "Sec-CH-UA-Platform", example: '"macOS"', note: "usually set by the browser" },
  { name: "Sec-CH-UA-Mobile", example: "?0", note: "usually set by the browser" },
  { name: "DPR", example: "2" },
  { name: "Viewport-Width", example: "1280" },
  { name: "Save-Data", example: "on" },
  { name: "Downlink", example: "10" },
  { name: "ECT", example: "4g" },
  { name: "RTT", example: "50" },

  // Fetch metadata (browser-controlled)
  { name: "Sec-Fetch-Site", example: "same-origin", note: "usually set by the browser" },
  { name: "Sec-Fetch-Mode", example: "cors", note: "usually set by the browser" },
  { name: "Sec-Fetch-Dest", example: "empty", note: "usually set by the browser" },
  { name: "Sec-Fetch-User", example: "?1", note: "usually set by the browser" },

  // CORS preflight
  { name: "Access-Control-Request-Method", example: "POST" },
  { name: "Access-Control-Request-Headers", example: "content-type" },

  // Privacy / hints
  { name: "DNT", example: "1" },
  { name: "Sec-GPC", example: "1" },
  { name: "Upgrade-Insecure-Requests", example: "1" },
  { name: "Priority", example: "u=1, i" },

  // Connection / transfer (browser-controlled)
  { name: "Connection", example: "keep-alive", note: "usually set by the browser" },
  { name: "TE", example: "trailers", note: "usually set by the browser" },
  { name: "Expect", example: "100-continue" },
  { name: "Max-Forwards", example: "10" },
  { name: "Via", example: "1.1 proxy.example.com" },
  { name: "Forwarded", example: "for=203.0.113.1;proto=https" },

  // De-facto / non-standard X-* headers people actually inject
  { name: "X-Requested-With", example: "XMLHttpRequest" },
  { name: "X-Forwarded-For", example: "203.0.113.1" },
  { name: "X-Forwarded-Host", example: "example.com" },
  { name: "X-Forwarded-Proto", example: "https" },
  { name: "X-Real-IP", example: "203.0.113.1" },
  { name: "X-Api-Key", example: "<key>" },
  { name: "X-CSRF-Token", example: "<token>" },
  { name: "X-HTTP-Method-Override", example: "PATCH" },
  { name: "X-Request-ID", example: "<uuid>" },
  { name: "X-Correlation-ID", example: "<uuid>" },
];

// name (lowercased) -> entry, for quick lookup when the user types/picks a name.
export const HEADER_BY_NAME = new Map(STANDARD_HEADERS.map((h) => [h.name.toLowerCase(), h]));
