package com.infurnus.app

import android.content.Intent
import io.flutter.embedding.android.FlutterActivity

import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {

    private var locationSettings: LocationSettingsBridge? = null

    override fun cleanUpFlutterEngine(flutterEngine: FlutterEngine) {
        locationSettings?.close()
        locationSettings = null
        super.cleanUpFlutterEngine(flutterEngine)
    }

    @Deprecated("Activity result forwarded by FlutterActivity")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        locationSettings?.onActivityResult(requestCode, resultCode)
    }

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        locationSettings = LocationSettingsBridge(this, flutterEngine.dartExecutor.binaryMessenger)
    }
}
