#include <jni.h>
#include <cstdlib>
#include <cstring>
#include "node.h"

extern "C" JNIEXPORT jint JNICALL
Java_uk_org_fancy_nxapi_mobile_MainActivity_startNodeWithArguments(
        JNIEnv *env, jobject, jobjectArray arguments) {
    jsize count = env->GetArrayLength(arguments);
    size_t size = 0;
    for (int i = 0; i < count; i++) {
        auto value = (jstring) env->GetObjectArrayElement(arguments, i);
        const char *text = env->GetStringUTFChars(value, nullptr);
        size += strlen(text) + 1;
        env->ReleaseStringUTFChars(value, text);
        env->DeleteLocalRef(value);
    }
    auto buffer = (char *) calloc(size, 1);
    auto argv = (char **) calloc(count, sizeof(char *));
    char *position = buffer;
    for (int i = 0; i < count; i++) {
        auto value = (jstring) env->GetObjectArrayElement(arguments, i);
        const char *text = env->GetStringUTFChars(value, nullptr);
        strcpy(position, text);
        argv[i] = position;
        position += strlen(position) + 1;
        env->ReleaseStringUTFChars(value, text);
        env->DeleteLocalRef(value);
    }
    int result = node::Start(count, argv);
    free(argv);
    free(buffer);
    return result;
}
