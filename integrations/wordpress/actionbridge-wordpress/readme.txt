=== ActionBridge for WordPress ===
Contributors: schwarzwald-agent
Tags: actionbridge, ai, automation, woocommerce
Requires at least: 6.0
Requires PHP: 8.1
Stable tag: 0.1.0
License: Proprietary pilot

Customer-consented WordPress/WooCommerce backend bridge for Schwarzwald-Agent ActionBridge.

== Description ==

This MVP scaffold connects WordPress to ActionBridge as a backend_bridge connector. It exposes a signed health endpoint and capability settings only. Live draft creation and WooCommerce reads remain disabled until production pairing, approval, audit, and Sentinel review are complete.

== Security ==

No secrets are printed into browser JavaScript. REST calls require HMAC headers, timestamp, nonce, and connector id. Keep enabled scopes narrow.
