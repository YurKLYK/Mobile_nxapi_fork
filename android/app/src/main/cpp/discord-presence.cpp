#include <jni.h>
#include <android/log.h>
#include <atomic>
#include <chrono>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

#define DISCORDPP_IMPLEMENTATION
#include <discordpp.h>

namespace {
constexpr const char* TAG = "nxapi-discord";
std::mutex clientMutex;
std::unique_ptr<discordpp::Client> client;
std::thread callbackThread;
std::atomic<bool> callbackRunning{false};
std::atomic<int> presenceStatus{0};

std::string fromJString(JNIEnv* env, jstring value) {
    if (!value) return {};
    const char* chars = env->GetStringUTFChars(value, nullptr);
    std::string result(chars ? chars : "");
    if (chars) env->ReleaseStringUTFChars(value, chars);
    return result;
}

void stopClient() {
    callbackRunning.store(false);
    if (callbackThread.joinable()) callbackThread.join();
    std::lock_guard<std::mutex> lock(clientMutex);
    client.reset();
    presenceStatus.store(0);
}
}

extern "C" JNIEXPORT jint JNICALL
Java_uk_org_fancy_nxapi_mobile_MainActivity_startDiscordPresence(
        JNIEnv*, jclass, jlong applicationId) {
    std::lock_guard<std::mutex> lock(clientMutex);
    if (client) return presenceStatus.load();

    presenceStatus.store(1);
    client = std::make_unique<discordpp::Client>();
    client->AddLogCallback([](std::string message, discordpp::LoggingSeverity severity) {
        __android_log_print(ANDROID_LOG_INFO, TAG, "[%d] %s", static_cast<int>(severity), message.c_str());
    }, discordpp::LoggingSeverity::Info);
    client->SetApplicationId(static_cast<uint64_t>(applicationId));

    callbackRunning.store(true);
    callbackThread = std::thread([] {
        while (callbackRunning.load()) {
            {
                std::lock_guard<std::mutex> lock(clientMutex);
                if (client) discordpp::RunCallbacks();
            }
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
        }
    });
    return 1;
}

extern "C" JNIEXPORT void JNICALL
Java_uk_org_fancy_nxapi_mobile_MainActivity_updateDiscordPresence(
        JNIEnv* env, jclass, jstring gameNameValue, jstring imageUrlValue,
        jstring detailsValue, jstring stateValue, jlong startedAt) {
    const std::string gameName = fromJString(env, gameNameValue);
    const std::string imageUrl = fromJString(env, imageUrlValue);
    const std::string details = fromJString(env, detailsValue);
    const std::string state = fromJString(env, stateValue);
    std::lock_guard<std::mutex> lock(clientMutex);
    if (!client) return;

    presenceStatus.store(1);
    discordpp::Activity activity{};
    activity.SetName(gameName.empty() ? "Nintendo Switch" : gameName);
    activity.SetDetails(details.empty() ?
        (gameName.empty() ? std::string("Nintendo Switch") : gameName) : details);
    activity.SetState(state.empty() ? std::string("nxapi Mobile") : state);
    if (!imageUrl.empty()) {
        discordpp::ActivityAssets assets{};
        assets.SetLargeImage(imageUrl);
        assets.SetLargeText(gameName.empty() ? std::string("Nintendo Switch") : gameName);
        activity.SetAssets(std::move(assets));
    }
    if (startedAt > 0) {
        discordpp::ActivityTimestamps timestamps{};
        timestamps.SetStart(static_cast<uint64_t>(startedAt) * 1000);
        activity.SetTimestamps(std::move(timestamps));
    }
    client->UpdateRichPresence(std::move(activity), [](discordpp::ClientResult result) {
        if (result.Successful()) {
            presenceStatus.store(2);
            __android_log_print(ANDROID_LOG_INFO, TAG, "Rich Presence updated");
        } else {
            presenceStatus.store(-1);
            __android_log_print(ANDROID_LOG_ERROR, TAG, "Rich Presence failed: %s", result.ToString().c_str());
        }
    });
}

extern "C" JNIEXPORT jint JNICALL
Java_uk_org_fancy_nxapi_mobile_MainActivity_getDiscordPresenceStatus(
        JNIEnv*, jclass) {
    return presenceStatus.load();
}

extern "C" JNIEXPORT void JNICALL
Java_uk_org_fancy_nxapi_mobile_MainActivity_stopDiscordPresence(
        JNIEnv*, jclass) {
    stopClient();
}
