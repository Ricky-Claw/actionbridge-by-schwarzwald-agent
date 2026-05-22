<?php
if (!defined('ABSPATH')) {
    exit;
}

final class ActionBridge_WP_REST {
    public static function init(): void {
        add_action('rest_api_init', [self::class, 'register_routes']);
    }

    public static function register_routes(): void {
        register_rest_route('actionbridge/v1', '/health', [
            'methods' => 'GET',
            'callback' => [self::class, 'health'],
            'permission_callback' => [ActionBridge_WP_Security::class, 'verify_request'],
        ]);

        register_rest_route('actionbridge/v1', '/blog/draft', [
            'methods' => 'POST',
            'callback' => [self::class, 'blog_draft_disabled'],
            'permission_callback' => [ActionBridge_WP_Security::class, 'verify_request'],
        ]);
    }

    public static function health(WP_REST_Request $request): WP_REST_Response {
        $settings = get_option('actionbridge_wp_settings', []);
        return new WP_REST_Response([
            'ok' => true,
            'version' => ACTIONBRIDGE_WP_VERSION,
            'siteUrlDigest' => hash('sha256', home_url()),
            'targetId' => $settings['target_id'] ?? '',
            'connectorId' => $settings['connector_id'] ?? '',
            'enabledCapabilities' => ActionBridge_WP_Capabilities::enabled(),
            'woocommerceActive' => class_exists('WooCommerce'),
            'writesEnabled' => false,
        ]);
    }

    public static function blog_draft_disabled(WP_REST_Request $request): WP_Error {
        return new WP_Error('actionbridge_blog_draft_disabled', 'Blog draft creation is disabled until signing, pairing, approval, and Sentinel review are complete.', ['status' => 403]);
    }
}
