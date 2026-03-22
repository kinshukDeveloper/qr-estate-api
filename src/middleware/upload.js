const multer = require('multer');
const { createError } = require('./errorHandler');

const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
const MAX_SIZE = 10 * 1024 * 1024; // 10MB per file
const MAX_FILES = 10;

// Store in memory (buffer) — we pass it to Cloudinary directly
const storage = multer.memoryStorage();

function fileFilter(req, file, cb) {
  if (!ALLOWED_TYPES.includes(file.mimetype)) {
    return cb(createError('Only JPEG, PNG and WebP images are allowed', 400), false);
  }
  cb(null, true);
}

// Single image upload
const uploadSingle = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE },
}).single('image');

// Multiple images upload (up to 10)
const uploadMultiple = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE, files: MAX_FILES },
}).array('images', MAX_FILES);

// Wrap multer in a promise so we can use async/await
function handleUpload(uploadFn) {
  return (req, res, next) => {
    uploadFn(req, res, (err) => {
      if (!err) return next();
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(createError('Image too large. Max 10MB per file.', 400));
      }
      if (err.code === 'LIMIT_FILE_COUNT') {
        return next(createError('Too many files. Max 10 images.', 400));
      }
      next(err);
    });
  };
}

module.exports = {
  uploadSingle: handleUpload(uploadSingle),
  uploadMultiple: handleUpload(uploadMultiple),
};
