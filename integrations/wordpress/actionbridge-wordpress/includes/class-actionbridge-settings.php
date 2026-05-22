<?php
if (!defined('ABSPATH')) {
    exit;
}

final class ActionBridge_WP_Settings {
    public static function init(): void {
        add_action('admin_menu', [self::class, 'add_menu']);
        add_action('admin_init', [self::class, 'register_settings']);
        add_action('admin_post_actionbridge_pair', [self::class, 'handle_pairing']);
    }

    public static function add_menu(): void {
        add_options_page('ActionBridge', 'ActionBridge', 'manage_options', 'actionbridge', [self::class, 'render']);
    }

    public static function register_settings(): void {
        register_setting('actionbridge_wp', 'actionbridge_wp_settings', [
            'type' => 'array',
            'sanitize_callback' => [self::class, 'sanitize'],
            'default' => [],
        ]);
    }

    public static function sanitize(array $input): array {
        $allowed_capabilities = ActionBridge_WP_Capabilities::allowed();
        $enabled = isset($input['enabled_capabilities']) && is_array($input['enabled_capabilities']) ? $input['enabled_capabilities'] : [];

        $existing = get_option('actionbridge_wp_settings', []);
        $existing = is_array($existing) ? $existing : [];
        return [
            'base_url' => isset($input['base_url']) ? esc_url_raw($input['base_url']) : '',
            'target_id' => isset($input['target_id']) ? sanitize_text_field($input['target_id']) : '',
            'connector_id' => isset($input['connector_id']) ? sanitize_text_field($input['connector_id']) : '',
            'shared_secret' => isset($existing['shared_secret']) ? sanitize_text_field($existing['shared_secret']) : '',
            'secret_ref' => isset($input['secret_ref']) ? sanitize_text_field($input['secret_ref']) : (isset($existing['secret_ref']) ? sanitize_text_field($existing['secret_ref']) : ''),
            'enabled_capabilities' => array_values(array_intersect($allowed_capabilities, array_map('sanitize_text_field', $enabled))),
        ];
    }

    public static function handle_pairing(): void {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('You do not have permission to pair ActionBridge.', 'actionbridge'));
        }
        check_admin_referer('actionbridge_pair');
        $base_url = isset($_POST['actionbridge_base_url']) ? esc_url_raw(wp_unslash($_POST['actionbridge_base_url'])) : '';
        $code = isset($_POST['actionbridge_pairing_code']) ? sanitize_text_field(wp_unslash($_POST['actionbridge_pairing_code'])) : '';
        if ($base_url !== '' && $code !== '') {
            ActionBridge_WP_Client::exchange_pairing_code($base_url, $code);
        }
        wp_safe_redirect(admin_url('options-general.php?page=actionbridge'));
        exit;
    }

    public static function render(): void {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('You do not have permission to manage ActionBridge.', 'actionbridge'));
        }
        $settings = get_option('actionbridge_wp_settings', []);
        $enabled = ActionBridge_WP_Capabilities::enabled();
        ?>
        <div class="wrap">
            <h1>ActionBridge</h1>
            <p>Connect this WordPress site to Schwarzwald-Agent ActionBridge. Keep scopes narrow; writes stay draft/approval-first. Production must use one-time pairing and server-side secret storage.</p>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <?php wp_nonce_field('actionbridge_pair'); ?>
                <input type="hidden" name="action" value="actionbridge_pair" />
                <h2>Pair with ActionBridge</h2>
                <table class="form-table" role="presentation">
                    <tr><th scope="row"><label for="actionbridge-pair-base-url">ActionBridge Base URL</label></th><td><input id="actionbridge-pair-base-url" class="regular-text" name="actionbridge_base_url" value="<?php echo esc_attr($settings['base_url'] ?? ''); ?>" /></td></tr>
                    <tr><th scope="row"><label for="actionbridge-pairing-code">One-time Pairing Code</label></th><td><input id="actionbridge-pairing-code" class="regular-text" type="password" autocomplete="one-time-code" name="actionbridge_pairing_code" value="" /><p class="description">Shown once in ActionBridge. Exchanged server-side; not stored after use.</p></td></tr>
                </table>
                <?php submit_button('Pair ActionBridge'); ?>
            </form>
            <hr />
            <form method="post" action="options.php">
                <?php settings_fields('actionbridge_wp'); ?>
                <table class="form-table" role="presentation">
                    <tr><th scope="row"><label for="actionbridge-base-url">ActionBridge Base URL</label></th><td><input id="actionbridge-base-url" class="regular-text" name="actionbridge_wp_settings[base_url]" value="<?php echo esc_attr($settings['base_url'] ?? ''); ?>" /></td></tr>
                    <tr><th scope="row"><label for="actionbridge-target-id">Target ID</label></th><td><input id="actionbridge-target-id" class="regular-text" name="actionbridge_wp_settings[target_id]" value="<?php echo esc_attr($settings['target_id'] ?? ''); ?>" /></td></tr>
                    <tr><th scope="row"><label for="actionbridge-connector-id">Connector ID</label></th><td><input id="actionbridge-connector-id" class="regular-text" name="actionbridge_wp_settings[connector_id]" value="<?php echo esc_attr($settings['connector_id'] ?? ''); ?>" /></td></tr>
                    <tr><th scope="row">Connection</th><td><code><?php echo empty($settings['secret_ref']) ? 'not paired' : esc_html($settings['secret_ref']); ?></code><input type="hidden" name="actionbridge_wp_settings[secret_ref]" value="<?php echo esc_attr($settings['secret_ref'] ?? ''); ?>" /><p class="description">Shared secret is stored server-side only and never printed back into the admin form.</p></td></tr>
                    <tr><th scope="row">Capabilities</th><td>
                        <p><strong>Pilot status:</strong> signed health/connectivity only. No WordPress content, order, or workflow action is executable yet.</p>
                        <?php foreach (ActionBridge_WP_Capabilities::planned() as $capability): ?>
                            <label><input type="checkbox" disabled="disabled" /> <?php echo esc_html($capability); ?> <em>planned, disabled</em></label><br />
                        <?php endforeach; ?>
                    </td></tr>
                </table>
                <?php submit_button('Save ActionBridge Settings'); ?>
            </form>
        </div>
        <?php
    }
}
