package br.leitor.app;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;
import android.util.Log;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.OutputStream;

/** Grava o ZIP no documento escolhido pelo usuário no seletor do Android. */
@CapacitorPlugin(name = "BackupFiles")
public class BackupFilesPlugin extends Plugin {
    private static final String TAG = "LeitorBackup";
    private static final int MAX_BASE64_SIZE = 128 * 1024;
    private boolean picking;
    private Uri destination;
    private OutputStream output;

    @PluginMethod
    public void begin(PluginCall call) {
        if (picking || destination != null) {
            call.reject("Já existe uma exportação em andamento.");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType("application/zip")
                .putExtra(Intent.EXTRA_TITLE, call.getString("name", "leitor-biblioteca.zip"));
        picking = true;
        try {
            startActivityForResult(call, intent, "documentSelected");
        } catch (RuntimeException error) {
            picking = false;
            call.reject("O seletor de destino do Android não está disponível.", error);
        }
    }

    @ActivityCallback
    private void documentSelected(PluginCall call, ActivityResult result) {
        execute(() -> {
            picking = false;
            Intent data = result.getData();
            Uri uri = data == null ? null : data.getData();
            if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
                if (call != null) call.resolve(new JSObject().put("selected", false));
                return;
            }

            destination = uri;
            if (call == null || PluginCall.CALLBACK_ID_DANGLING.equals(call.getCallbackId())) {
                discard();
                return;
            }
            try {
                output = resolver().openOutputStream(uri, "wt");
                if (output == null) throw new IOException("Destino indisponível.");
                call.resolve(new JSObject().put("selected", true));
            } catch (IOException | RuntimeException error) {
                discard();
                call.reject("Falha ao abrir o destino do backup.", error);
            }
        });
    }

    @PluginMethod
    public void append(PluginCall call) {
        String data = call.getString("base64");
        if (output == null || data == null || data.isEmpty() || data.length() > MAX_BASE64_SIZE) {
            call.reject("Trecho do backup inválido ou destino indisponível.");
            return;
        }

        try {
            output.write(Base64.decode(data, Base64.NO_WRAP));
            call.resolve();
        } catch (IOException | RuntimeException error) {
            discard();
            call.reject("Falha ao gravar o backup.", error);
        }
    }

    @PluginMethod
    public void finish(PluginCall call) {
        if (output == null) {
            call.reject("O destino do backup não está aberto.");
            return;
        }

        try {
            output.close();
            output = null;
            destination = null;
            call.resolve();
        } catch (IOException | RuntimeException error) {
            discard();
            call.reject("Falha ao finalizar o backup.", error);
        }
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        discard();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        execute(this::discard);
    }

    private ContentResolver resolver() {
        return getContext().getContentResolver();
    }

    private void discard() {
        if (output != null) {
            try {
                output.close();
            } catch (IOException | RuntimeException error) {
                Log.w(TAG, "Falha ao fechar o backup interrompido", error);
            }
            output = null;
        }
        if (destination == null) return;
        try {
            DocumentsContract.deleteDocument(resolver(), destination);
        } catch (IOException | RuntimeException error) {
            Log.w(TAG, "Falha ao remover o backup interrompido", error);
        } finally {
            destination = null;
        }
    }
}
