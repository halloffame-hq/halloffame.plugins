package toneflix.halloffame.capacitor.gallery;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Context;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Size;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import java.io.ByteArrayOutputStream;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;

/** The device's images and videos, newest first, read through MediaStore. */
final class MediaLibrary {
    private static final String DURATION = "duration";
    private static final String NEWEST_FIRST =
        MediaStore.MediaColumns.DATE_ADDED + " DESC, " + MediaStore.MediaColumns._ID + " DESC";

    private final Context context;

    private final ContentResolver resolver;

    MediaLibrary(Context context) {
        this.context = context;
        resolver = context.getContentResolver();
    }

    /** One page of items, with `hasMore` when another page follows. */
    JSObject page(int offset, int limit, boolean images, boolean videos, int thumbnailSize) {
        JSArray items = new JSArray();
        boolean hasMore = false;

        try (Cursor cursor = query(offset, limit + 1, images, videos)) {
            int read = 0;

            while (cursor != null && cursor.moveToNext()) {
                if (read == limit) {
                    hasMore = true;
                    break;
                }

                items.put(item(cursor, thumbnailSize));
                read++;
            }
        }

        JSObject page = new JSObject();
        page.put("items", items);
        page.put("hasMore", hasMore);

        return page;
    }

    /** The item's own URI, which the WebView reads directly, with its name and type. */
    JSObject file(String id) {
        Uri uri = Uri.parse(id);
        String name = "media";
        String mimeType = resolver.getType(uri);

        try (Cursor cursor = resolver.query(
            uri,
            new String[] { MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.MIME_TYPE },
            null,
            null,
            null
        )) {
            if (cursor != null && cursor.moveToFirst()) {
                name = cursor.getString(0) != null ? cursor.getString(0) : name;
                mimeType = cursor.getString(1) != null ? cursor.getString(1) : mimeType;
            }
        }

        JSObject file = new JSObject();
        file.put("path", uri.toString());
        file.put("mimeType", mimeType == null ? "application/octet-stream" : mimeType);
        file.put("name", name);

        return file;
    }

    private Cursor query(int offset, int limit, boolean images, boolean videos) {
        List<String> types = new ArrayList<>();
        if (images) types.add(String.valueOf(MediaStore.Files.FileColumns.MEDIA_TYPE_IMAGE));
        if (videos) types.add(String.valueOf(MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO));

        StringBuilder placeholders = new StringBuilder();
        for (int index = 0; index < types.size(); index++) placeholders.append(index == 0 ? "?" : ",?");

        String selection = MediaStore.Files.FileColumns.MEDIA_TYPE + " IN (" + placeholders + ")";
        String[] args = types.toArray(new String[0]);
        Uri collection = MediaStore.Files.getContentUri("external");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Bundle query = new Bundle();
            query.putString(ContentResolver.QUERY_ARG_SQL_SELECTION, selection);
            query.putStringArray(ContentResolver.QUERY_ARG_SQL_SELECTION_ARGS, args);
            query.putString(ContentResolver.QUERY_ARG_SQL_SORT_ORDER, NEWEST_FIRST);
            query.putInt(ContentResolver.QUERY_ARG_LIMIT, limit);
            query.putInt(ContentResolver.QUERY_ARG_OFFSET, offset);

            return resolver.query(collection, projection(), query, null);
        }

        return resolver.query(
            collection,
            projection(),
            selection,
            args,
            NEWEST_FIRST + " LIMIT " + limit + " OFFSET " + offset
        );
    }

    private String[] projection() {
        List<String> columns = new ArrayList<>(Arrays.asList(
            MediaStore.MediaColumns._ID,
            MediaStore.Files.FileColumns.MEDIA_TYPE,
            MediaStore.MediaColumns.MIME_TYPE,
            MediaStore.MediaColumns.DISPLAY_NAME,
            MediaStore.MediaColumns.WIDTH,
            MediaStore.MediaColumns.HEIGHT,
            MediaStore.MediaColumns.DATE_ADDED
        ));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) columns.add(DURATION);

        return columns.toArray(new String[0]);
    }

    private JSObject item(Cursor cursor, int thumbnailSize) {
        long id = cursor.getLong(0);
        boolean video = cursor.getInt(1) == MediaStore.Files.FileColumns.MEDIA_TYPE_VIDEO;
        Uri uri = ContentUris.withAppendedId(
            video ? MediaStore.Video.Media.EXTERNAL_CONTENT_URI : MediaStore.Images.Media.EXTERNAL_CONTENT_URI,
            id
        );

        JSObject item = new JSObject();
        item.put("id", uri.toString());
        item.put("type", video ? "video" : "image");
        item.put("mimeType", cursor.getString(2) == null ? (video ? "video/mp4" : "image/jpeg") : cursor.getString(2));
        item.put("name", cursor.getString(3) == null ? "media" : cursor.getString(3));
        item.put("width", cursor.getInt(4));
        item.put("height", cursor.getInt(5));
        item.put("createdAt", isoDate(cursor.getLong(6) * 1000L));
        if (video) item.put("duration", durationOf(cursor, id, uri) / 1000.0);
        item.put("thumbnail", thumbnail(uri, id, video, thumbnailSize));

        return item;
    }

    /** Milliseconds, from MediaStore or, when it has none, from the file itself. */
    private long durationOf(Cursor cursor, long id, Uri uri) {
        long indexed = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? cursor.getLong(7) : indexedDuration(id);

        return indexed > 0 ? indexed : fileDuration(uri);
    }

    private long fileDuration(Uri uri) {
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();

        try {
            retriever.setDataSource(context, uri);
            String duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);

            return duration == null ? 0L : Long.parseLong(duration);
        } catch (Exception unreadable) {
            return 0L;
        } finally {
            try { retriever.release(); } catch (Exception ignored) { }
        }
    }

    private long indexedDuration(long id) {
        try (Cursor video = resolver.query(
            MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
            new String[] { MediaStore.Video.VideoColumns.DURATION },
            MediaStore.MediaColumns._ID + " = ?",
            new String[] { String.valueOf(id) },
            null
        )) {
            return video != null && video.moveToFirst() ? video.getLong(0) : 0L;
        }
    }

    @SuppressWarnings("deprecation")
    private String thumbnail(Uri uri, long id, boolean video, int size) {
        Bitmap bitmap = null;

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                bitmap = resolver.loadThumbnail(uri, new Size(size, size), null);
            } else if (video) {
                bitmap = MediaStore.Video.Thumbnails.getThumbnail(
                    resolver, id, MediaStore.Video.Thumbnails.MINI_KIND, null
                );
            } else {
                bitmap = MediaStore.Images.Thumbnails.getThumbnail(
                    resolver, id, MediaStore.Images.Thumbnails.MINI_KIND, null
                );
            }
            if (bitmap == null) return "";

            ByteArrayOutputStream jpeg = new ByteArrayOutputStream();
            bitmap.compress(Bitmap.CompressFormat.JPEG, 70, jpeg);

            return Base64.encodeToString(jpeg.toByteArray(), Base64.NO_WRAP);
        } catch (Exception unreadable) {
            return "";
        } finally {
            if (bitmap != null) bitmap.recycle();
        }
    }

    private static String isoDate(long millis) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));

        return format.format(new Date(millis));
    }
}
