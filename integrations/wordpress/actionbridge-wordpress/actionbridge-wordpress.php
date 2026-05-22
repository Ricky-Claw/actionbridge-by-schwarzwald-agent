<?php
/**
 * Plugin Name: ActionBridge for WordPress
 * Description: Customer-consented WordPress/WooCommerce backend bridge for Schwarzwald-Agent ActionBridge.
 * Version: 0.1.0
 * Author: Schwarzwald-Agent
 * Requires PHP: 8.1
 * Requires at least: 6.0
 */

if (!defined('ABSPATH')) {
    exit;
}

define('ACTIONBRIDGE_WP_VERSION', '0.1.0');
define('ACTIONBRIDGE_WP_PLUGIN_FILE', __FILE__);
define('ACTIONBRIDGE_WP_PLUGIN_DIR', plugin_dir_path(__FILE__));

require_once ACTIONBRIDGE_WP_PLUGIN_DIR . 'includes/class-actionbridge-capabilities.php';
require_once ACTIONBRIDGE_WP_PLUGIN_DIR . 'includes/class-actionbridge-security.php';
require_once ACTIONBRIDGE_WP_PLUGIN_DIR . 'includes/class-actionbridge-client.php';
require_once ACTIONBRIDGE_WP_PLUGIN_DIR . 'includes/class-actionbridge-settings.php';
require_once ACTIONBRIDGE_WP_PLUGIN_DIR . 'includes/class-actionbridge-rest.php';

add_action('plugins_loaded', static function (): void {
    ActionBridge_WP_Settings::init();
    ActionBridge_WP_REST::init();
});

register_uninstall_hook(__FILE__, 'actionbridge_wp_uninstall');

function actionbridge_wp_uninstall(): void {
    delete_option('actionbridge_wp_settings');
    delete_option('actionbridge_wp_replay_nonces');
}
