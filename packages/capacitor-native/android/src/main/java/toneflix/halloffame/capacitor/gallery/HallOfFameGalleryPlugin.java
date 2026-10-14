package toneflix.halloffame.capacitor.gallery;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONException;

import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Reads the device's own images and videos for the in-app gallery. */
@CapacitorPlugin(
    name = "HallOfFameGallery",
    permissions = {
        @Permission(alias = HallOfFameGalleryPlugin.LEGACY, strings = { Manifest.permission.READ_EXTERNAL_STORAGE }),
        @Permission(
            alias = HallOfFameGalleryPlugin.MEDIA,
            strings = { Manifest.permission.READ_MEDIA_IMAGES, Manifest.permission.READ_MEDIA_VIDEO }
        ),
        @Permission(
            alias = HallOfFameGalleryPlugin.SELECTED,
            strings = { Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED }
        ),
    }
)
public class HallOfFameGalleryPlugin extends Plugin {
    static final String LEGACY = "legacy";
    static final String MEDIA = "media";
    static final String SELECTED = "selected";

    private static final int DEFAULT_THUMBNAIL = 320;

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private MediaLibrary library;

    @Override public void load() {
        library = new MediaLibrary(getContext());
    }

    @Override protected void handleOnDestroy() {
        worker.shutdownNow();
        super.handleOnDestroy();
    }

    @PluginMethod public void checkAccess(PluginCall call) {
        call.resolve(accessResult());
    }

    @PluginMethod public void requestAccess(PluginCall call) {
        if ("granted".equals(access())) {
            call.resolve(accessResult());
            return;
        }

        requestPermissionForAliases(aliases(), call, "accessAnswered");
    }

    /** Android re-asks, which on Android 14 lets a person change their selection. */
    @PluginMethod public void manageAccess(PluginCall call) {
        requestPermissionForAliases(aliases(), call, "accessAnswered");
    }

    @PermissionCallback private void accessAnswered(PluginCall call) {
        call.resolve(accessResult());
    }

    @PluginMethod public void list(PluginCall call) {
        String access = access();
        if (!"granted".equals(access) && !"limited".equals(access)) {
            call.reject("Allow access to photos and videos first.", "ACCESS_DENIED");
            return;
        }

        int offset = Math.max(0, call.getInt("offset", 0));
        int limit = Math.max(1, Math.min(120, call.getInt("limit", 60)));
        int thumbnailSize = Math.max(64, Math.min(1024, call.getInt("thumbnailSize", DEFAULT_THUMBNAIL)));
        boolean images = true;
        boolean videos = true;

        JSArray types = call.getArray("types");
        if (types != null) {
            try {
                List<String> requested = types.toList();
                images = requested.contains("image");
                videos = requested.contains("video");
            } catch (JSONException malformed) {
                call.reject("`types` must list image and/or video.");
                return;
            }
        }
        if (!images && !videos) {
            call.reject("`types` must list image and/or video.");
            return;
        }

        boolean wantImages = images;
        boolean wantVideos = videos;
        worker.execute(() -> {
            try {
                call.resolve(library.page(offset, limit, wantImages, wantVideos, thumbnailSize));
            } catch (Exception failure) {
                call.reject("The gallery could not be read.", failure);
            }
        });
    }

    @PluginMethod public void file(PluginCall call) {
        String id = call.getString("id");
        if (id == null || !id.startsWith("content://")) {
            call.reject("`id` must be a gallery item id.");
            return;
        }

        worker.execute(() -> {
            try {
                call.resolve(library.file(id));
            } catch (Exception failure) {
                call.reject("That item could not be read.", failure);
            }
        });
    }

    private String[] aliases() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return new String[] { MEDIA, SELECTED };
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) return new String[] { MEDIA };

        return new String[] { LEGACY };
    }

    private String access() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (granted(Manifest.permission.READ_MEDIA_IMAGES) && granted(Manifest.permission.READ_MEDIA_VIDEO)) {
                return "granted";
            }
            if (
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
                    && granted(Manifest.permission.READ_MEDIA_VISUAL_USER_SELECTED)
            ) {
                return "limited";
            }

            return getPermissionState(MEDIA) == PermissionState.DENIED ? "denied" : "prompt";
        }

        if (granted(Manifest.permission.READ_EXTERNAL_STORAGE)) return "granted";

        return getPermissionState(LEGACY) == PermissionState.DENIED ? "denied" : "prompt";
    }

    private JSObject accessResult() {
        JSObject result = new JSObject();
        result.put("access", access());

        return result;
    }

    private boolean granted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }
}
