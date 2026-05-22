<?php
if (!defined('ABSPATH')) {
    exit;
}

final class ActionBridge_WP_Client {
    public static function exchange_pairing_code(string $base_url, string $code): true|WP_Error {
        $endpoint = trailingslashit($base_url) . 'api/actionbridge/backend-bridge/pairing';
        $response = wp_remote_request($endpoint, [
            'method' => 'PATCH',
            'timeout' => 15,
            'headers' => ['Content-Type' => 'application/json'],
            'body' => wp_json_encode([
                'code' => $code,
                'pluginInfo' => [
                    'pluginVersion' => ACTIONBRIDGE_WP_VERSION,
                    'siteUrlDigest' => hash('sha256', home_url()),
                    'wordpressVersion' => get_bloginfo('version'),
                    'woocommerceActive' => class_exists('WooCommerce'),
                ],
            ]),
        ]);

        if (is_wp_error($response)) {
            return $response;
        }

        $status = wp_remote_retrieve_response_code($response);
        $body = json_decode(wp_remote_retrieve_body($response), true);
        if ($status < 200 || $status >= 300 || !is_array($body) || empty($body['pairing']['sharedSecret'])) {
            return new WP_Error('actionbridge_pairing_failed', 'ActionBridge pairing exchange failed.', ['status' => $status]);
        }

        $settings = get_option('actionbridge_wp_settings', []);
        $settings = is_array($settings) ? $settings : [];
        $settings['base_url'] = esc_url_raw($base_url);
        $settings['shared_secret'] = sanitize_text_field($body['pairing']['sharedSecret']);
        $settings['secret_ref'] = isset($body['pairing']['secretRef']) ? sanitize_text_field($body['pairing']['secretRef']) : '';
        $settings['connector_id'] = isset($body['pairing']['connectorId']) ? sanitize_text_field($body['pairing']['connectorId']) : ($settings['connector_id'] ?? '');
        unset($settings['pairing_code']);
        update_option('actionbridge_wp_settings', $settings, false);

        $health = self::report_signed_health($settings);
        if (is_wp_error($health)) {
            return $health;
        }

        return true;
    }

    public static function report_signed_health(array $settings): true|WP_Error {
        $base_url = isset($settings['base_url']) ? (string) $settings['base_url'] : '';
        $connector_id = isset($settings['connector_id']) ? (string) $settings['connector_id'] : '';
        $shared_secret = isset($settings['shared_secret']) ? (string) $settings['shared_secret'] : '';
        if ($base_url === '' || $connector_id === '' || $shared_secret === '') {
            return new WP_Error('actionbridge_health_not_configured', 'ActionBridge signed health is not configured.', ['status' => 400]);
        }

        $endpoint = trailingslashit($base_url) . 'api/actionbridge/backend-bridge/health';
        $timestamp = (string) time();
        $nonce = wp_generate_password(32, false, false);
        $health = self::create_health_payload();
        $health_digest = hash('sha256', wp_json_encode($health));
        $shared_secret_digest = 'sha256:' . hash('sha256', $shared_secret);
        $payload = $connector_id . "\n" . $timestamp . "\n" . $nonce . "\n" . $health_digest;
        $signature = 'sha256:' . hash_hmac('sha256', $payload, $shared_secret_digest);

        $response = wp_remote_request($endpoint, [
            'method' => 'POST',
            'timeout' => 15,
            'headers' => ['Content-Type' => 'application/json'],
            'body' => wp_json_encode([
                'connectorId' => $connector_id,
                'timestamp' => $timestamp,
                'nonce' => $nonce,
                'signature' => $signature,
                'health' => $health,
            ]),
        ]);

        if (is_wp_error($response)) {
            return $response;
        }

        $status = wp_remote_retrieve_response_code($response);
        if ($status < 200 || $status >= 300) {
            return new WP_Error('actionbridge_health_failed', 'ActionBridge signed health verification failed.', ['status' => $status]);
        }

        return true;
    }

    private static function create_health_payload(): array {
        return [
            'ok' => true,
            'pluginVersion' => ACTIONBRIDGE_WP_VERSION,
            'platform' => 'wordpress',
            'siteUrlDigest' => hash('sha256', home_url()),
            'wordpressVersion' => get_bloginfo('version'),
            'woocommerceActive' => class_exists('WooCommerce'),
            'writesEnabled' => false,
            'enabledCapabilities' => ActionBridge_WP_Capabilities::enabled(),
        ];
    }
}
