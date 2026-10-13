import java.util.Properties

val keystoreProperties = Properties()
val keystorePropertiesFile = rootProject.file("key.properties")
// Explicit operator opt-in for test APKs only; normal releases still require approved signing.
val testReleaseSigning = System.getenv("INFURNUS_TEST_RELEASE_SIGNING") == "true"

if (keystorePropertiesFile.exists()) {
    keystorePropertiesFile.inputStream().use {
        keystoreProperties.load(it)
    }
}

if (!testReleaseSigning && gradle.startParameter.taskNames.any { it.contains("release", ignoreCase = true) }) {
    require(listOf("keyAlias", "keyPassword", "storeFile", "storePassword").all {
        !keystoreProperties.getProperty(it).isNullOrBlank()
    }) { "Release signing requires a complete local android/key.properties file." }
}

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

val localProperties = Properties()
val localPropertiesFile = rootProject.file("local.properties")
if (localPropertiesFile.exists()) {
    localPropertiesFile.inputStream().use { localProperties.load(it) }
}

val mapsApiKey: String = localProperties.getProperty("MAPS_API_KEY")
    ?: (project.findProperty("MAPS_API_KEY") as? String)
    ?: System.getenv("MAPS_API_KEY")
    ?: ""

// Fail before packaging a blank Maps credential into an APK. Configure the
// Android SDK key through ignored local.properties or the build environment.
if (gradle.startParameter.taskNames.any { it.contains("assemble", ignoreCase = true) || it.contains("bundle", ignoreCase = true) }) {
    require(mapsApiKey.isNotBlank()) { "Android Maps SDK configuration is required: set MAPS_API_KEY in ignored android/local.properties or the build environment." }
}
// Public OAuth audience only; never package backend environment files or secrets.
val googleWebClientId: String = localProperties.getProperty("GOOGLE_WEB_CLIENT_ID")
    ?: (project.findProperty("GOOGLE_WEB_CLIENT_ID") as? String)
    ?: System.getenv("GOOGLE_WEB_CLIENT_ID")
    ?: ""

android {
    namespace = "com.infurnus.app"
    compileSdk = 37
    ndkVersion = "30.0.16248370"

    signingConfigs {
        create("release") {
            keyAlias = keystoreProperties.getProperty("keyAlias")
            keyPassword = keystoreProperties.getProperty("keyPassword")
            storeFile = keystoreProperties.getProperty("storeFile")?.let { file(it) }
            storePassword = keystoreProperties.getProperty("storePassword")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true
    }

    defaultConfig {
        // TODO: Specify your own unique Application ID (https://developer.android.com/studio/build/application-id.html).
        applicationId = "com.infurnus.app"

        // You can update the following values to match your application needs.
        // For more information, see: https://flutter.dev/to/review-gradle-config.
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion

        // Uses the version code from pubspec.yaml. When using split APKs, 1000 * ABI_VERSION
        // is added automatically by Flutter. (https://developer.android.com/studio/build/configure-apk-splits#configure-APK-versions)
        // You can force using the value of versionCode by specifying the
        // `-P force-version-code-ignoring-abi=true` flag during build.
        versionCode = flutter.versionCode
        versionName = flutter.versionName

        manifestPlaceholders["MAPS_API_KEY"] = mapsApiKey
        if (googleWebClientId.isNotBlank()) {
            resValue("string", "default_web_client_id", googleWebClientId)
        }
    }

    buildTypes {
        release {
            // Release builds require operator-supplied signing credentials.
            signingConfig = signingConfigs.getByName(if (testReleaseSigning) "debug" else "release")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.1.5")
}
