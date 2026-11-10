package com.infurnus.app

import android.app.Activity
import android.content.Context
import android.content.IntentSender
import android.location.LocationManager
import androidx.core.location.LocationManagerCompat
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import android.util.Log
import io.flutter.embedding.android.FlutterActivity
import com.google.android.gms.common.api.ResolvableApiException
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.LocationSettingsRequest
import com.google.android.gms.location.Priority
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel

internal class LocationSettingsBridge(private val activity: FlutterActivity, messenger: BinaryMessenger) : DefaultLifecycleObserver {
    private val channel = MethodChannel(messenger, "infurnus/location_settings")
    private var pending: MethodChannel.Result? = null
    private var checking = false
    private var dialogOpen = false

    init {
        activity.lifecycle.addObserver(this)
        channel.setMethodCallHandler { call, result ->
            when {
                call.method == "isEnabled" -> {
                    val manager = activity.getSystemService(Context.LOCATION_SERVICE) as LocationManager
                    result.success(LocationManagerCompat.isLocationEnabled(manager))
                }
                call.method != "resolve" -> result.notImplemented()
                pending != null -> result.success("cancelled")
                else -> resolve(result)
            }
        }
    }

    private fun resolve(result: MethodChannel.Result) {
        pending = result
        checkSettings()
    }

    override fun onResume(owner: LifecycleOwner) {
        checkSettings()
    }

    private fun checkSettings() {
        if (pending == null || checking || dialogOpen || !isResumed()) return
        checking = true
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 10000).build()
        val settings = LocationSettingsRequest.Builder().addLocationRequest(request).build()
        LocationServices.getSettingsClient(activity).checkLocationSettings(settings)
            .addOnSuccessListener {
                checking = false
                finish("enabled")
            }
            .addOnFailureListener { error ->
                checking = false
                if (pending == null) return@addOnFailureListener
                if (error !is ResolvableApiException || activity.isFinishing || activity.isDestroyed) {
                    finish("unavailable")
                    return@addOnFailureListener
                }
                if (!isResumed()) return@addOnFailureListener
                try {
                    dialogOpen = true
                    error.startResolutionForResult(activity, REQUEST_CODE)
                } catch (_: IntentSender.SendIntentException) {
                    finish("unavailable")
                }
            }
    }

    fun onActivityResult(requestCode: Int, resultCode: Int) {
        if (requestCode == REQUEST_CODE) {
            finish(if (resultCode == Activity.RESULT_OK) "enabled" else "cancelled")
        }
    }

    private fun isResumed() = activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)

    fun close() {
        activity.lifecycle.removeObserver(this)
        channel.setMethodCallHandler(null)
        finish("cancelled")
    }

    private fun finish(status: String) {
        val result = pending
        pending = null
        dialogOpen = false
        if (result != null) {
            Log.d("InfurnusLocation", "Location resolution completed: $status")
            result.success(status)
        }
    }

    private companion object {
        const val REQUEST_CODE = 40761
    }
}
