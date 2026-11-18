package expo.modules.vigiacameraserver

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.SystemClock
import android.util.Size
import android.view.ViewGroup
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.ByteArrayOutputStream
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import kotlin.math.ceil

/**
 * Camera preview that also feeds the MJPEG server, all on the native side:
 * CameraX gives RGBA frames, they are reduced, turned upright and encoded here,
 * so no frame crosses the JavaScript bridge. Same output as the Flutter app:
 * a 1280x720 stream reduced to at most 960 px wide, JPEG quality 70.
 */
class CameraStreamView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onCameraStarted by EventDispatcher()
  private val onCameraError by EventDispatcher()

  private val previewView = PreviewView(context).apply {
    layoutParams = LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    scaleType = PreviewView.ScaleType.FILL_CENTER
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
  }
  private var analysisExecutor: ExecutorService = Executors.newSingleThreadExecutor()
  private var provider: ProcessCameraProvider? = null
  private var bound = false
  @Volatile private var lastFrameAt = 0L

  var active = false
  @Volatile var fps = 8
  @Volatile var extraRotation = 0

  init {
    addView(previewView)
  }

  fun refresh() {
    if (active && isAttachedToWindow) bind() else unbind()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    refresh()
  }

  override fun onDetachedFromWindow() {
    unbind()
    super.onDetachedFromWindow()
  }

  fun destroy() {
    unbind()
    analysisExecutor.shutdown()
  }

  private fun bind() {
    if (bound) return
    val owner = appContext.currentActivity as? LifecycleOwner
    if (owner == null) {
      onCameraError(mapOf("message" to "No hay una actividad activa para abrir la cámara."))
      return
    }
    if (analysisExecutor.isShutdown) analysisExecutor = Executors.newSingleThreadExecutor()
    bound = true
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      try {
        if (!bound || !active) return@addListener
        val cameraProvider = future.get()
        provider = cameraProvider
        val selector = ResolutionSelector.Builder()
          .setAspectRatioStrategy(AspectRatioStrategy.RATIO_16_9_FALLBACK_AUTO_STRATEGY)
          .setResolutionStrategy(
            ResolutionStrategy(Size(1280, 720), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER),
          )
          .build()
        val preview = Preview.Builder().setResolutionSelector(selector).build().also {
          it.setSurfaceProvider(previewView.surfaceProvider)
        }
        val analysis = ImageAnalysis.Builder()
          .setResolutionSelector(selector)
          .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
          .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
          .build()
        analysis.setAnalyzer(analysisExecutor, ::analyze)
        cameraProvider.unbindAll()
        cameraProvider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
        onCameraStarted(mapOf())
      } catch (error: Exception) {
        bound = false
        onCameraError(mapOf("message" to (error.message ?: "No se pudo abrir la cámara.")))
      }
    }, ContextCompat.getMainExecutor(context))
  }

  private fun unbind() {
    if (!bound) return
    bound = false
    try {
      provider?.unbindAll()
    } catch (_: Exception) {
      // Already released with the activity.
    }
  }

  private fun analyze(image: ImageProxy) {
    try {
      val now = SystemClock.elapsedRealtime()
      if (now - lastFrameAt < 1000L / fps.coerceIn(1, 30)) return
      val server = CameraServerHolder.server
      if (server == null || !server.isRunning) return
      lastFrameAt = now
      server.publish(encode(image))
    } catch (_: Exception) {
      // One bad frame must not stop the stream; the next one is tried.
    } finally {
      image.close()
    }
  }

  private fun encode(image: ImageProxy): ByteArray {
    val source = image.toBitmap()
    val step = ceil(source.width / maxWidth.toDouble()).toInt().coerceIn(1, 8)
    val rotation = ((image.imageInfo.rotationDegrees + extraRotation) % 360 + 360) % 360
    val matrix = Matrix().apply {
      if (step > 1) postScale(1f / step, 1f / step)
      if (rotation != 0) postRotate(rotation.toFloat())
    }
    val upright = if (step == 1 && rotation == 0) source
    else Bitmap.createBitmap(source, 0, 0, source.width, source.height, matrix, true)
    return try {
      ByteArrayOutputStream(64 * 1024).use { output ->
        upright.compress(Bitmap.CompressFormat.JPEG, jpegQuality, output)
        output.toByteArray()
      }
    } finally {
      if (upright !== source) upright.recycle()
      source.recycle()
    }
  }

  companion object {
    private const val maxWidth = 960
    private const val jpegQuality = 70
  }
}

/** The module owns the server; the camera view publishes into it. */
internal object CameraServerHolder {
  @Volatile var server: MjpegHttpServer? = null
}
