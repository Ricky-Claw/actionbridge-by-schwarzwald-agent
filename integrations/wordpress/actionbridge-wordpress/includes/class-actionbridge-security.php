<?php
if (!defined('ABSPATH')) {
    exit;
}

final class ActionBridge_WP_Security {
    public static function get_shared_secret(): string {
        $settings = get_option('actionbridge_wp_settings', []);
        return isset($settings['shared_secret']) ? (string) $settings['shared_secret'] : '';
    }

    public static function verify_request(WP_REST_Request $request): true|WP_Error {
        $secret = self::get_shared_secret();
        if ($secret === '') {
            return new WP_Error('actionbridge_not_connected', 'ActionBridge is not connected.', ['status' => 401]);
        }

        $timestamp = (string) $request->get_header('x-actionbridge-timestamp');
        $signature = (string) $request->get_header('x-actionbridge-signature');
        $nonce = (string) $request->get_header('x-actionbridge-nonce');
        $connector_id = (string) $request->get_header('x-actionbridge-connector-id');

        if ($timestamp === '' || $signature === '' || $nonce === '' || $connector_id === '') {
            return new WP_Error('actionbridge_signature_missing', 'Missing ActionBridge signature headers.', ['status' => 401]);
        }

        $settings = get_option('actionbridge_wp_settings', []);
        $expected_connector_id = isset($settings['connector_id']) ? (string) $settings['connector_id'] : '';
        if ($expected_connector_id === '' || !hash_equals($expected_connector_id, $connector_id)) {
            return new WP_Error('actionbridge_connector_mismatch', 'ActionBridge connector mismatch.', ['status' => 401]);
        }

        if (abs(time() - (int) $timestamp) > 300) {
            return new WP_Error('actionbridge_signature_expired', 'Expired ActionBridge signature timestamp.', ['status' => 401]);
        }

        $body = $request->get_body() ?: '';
        $body_digest = hash('sha256', $body);
        $payload = strtoupper($request->get_method()) . "\n" . $request->get_route() . "\n" . $timestamp . "\n" . $nonce . "\n" . $connector_id . "\n" . $body_digest;
        $expected = 'sha256=' . hash_hmac('sha256', $payload, $secret);

        if (!hash_equals($expected, $signature)) {
            return new WP_Error('actionbridge_signature_invalid', 'Invalid ActionBridge signature.', ['status' => 401]);
        }

        if (!self::remember_nonce_once($connector_id, $nonce)) {
            return new WP_Error('actionbridge_replay_blocked', 'Replay nonce already used.', ['status' => 409]);
        }
        return true;
    }

    private static function remember_nonce_once(string $connector_id, string $nonce): bool {
        $safe_connector = preg_replace('/[^a-zA-Z0-9_-]/', '', $connector_id);
        $safe_nonce = preg_replace('/[^a-zA-Z0-9_-]/', '', $nonce);
        if ($safe_connector === '' || $safe_nonce === '') {
            return false;
        }
        $option = 'actionbridge_wp_nonce_' . hash('sha256', $safe_connector . ':' . $safe_nonce);
        return add_option($option, (string) time(), '', false);
    }
}
