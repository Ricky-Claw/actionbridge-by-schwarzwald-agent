<?php
if (!defined('ABSPATH')) {
    exit;
}

final class ActionBridge_WP_Capabilities {
    public const BLOG_DRAFT_CREATE = 'backend.write_draft:blog_post';
    public const ORDER_SUMMARY_READ = 'backend.read:orders';
    public const WORKFLOW_TRIGGER = 'workflow.trigger:wordpress';

    public static function allowed(): array {
        // Pilot plugin exposes signed health/connectivity only.
        // Capability execution stays disabled until each capability has live implementation,
        // approval policy, tests, and Sentinel review.
        return [];
    }

    public static function planned(): array {
        return [
            self::BLOG_DRAFT_CREATE,
            self::ORDER_SUMMARY_READ,
            self::WORKFLOW_TRIGGER,
        ];
    }

    public static function enabled(): array {
        $settings = get_option('actionbridge_wp_settings', []);
        $enabled = isset($settings['enabled_capabilities']) && is_array($settings['enabled_capabilities'])
            ? $settings['enabled_capabilities']
            : [];

        return array_values(array_intersect(self::allowed(), array_map('sanitize_text_field', $enabled)));
    }

    public static function is_enabled(string $capability): bool {
        return in_array($capability, self::enabled(), true);
    }
}
