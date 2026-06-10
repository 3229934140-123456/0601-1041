import { Router } from 'express';
import { protect, restrictTo } from '../middleware/auth';
import {
  getSavedFilters,
  createSavedFilter,
  updateSavedFilter,
  deleteSavedFilter,
  getScheduledExports,
  createScheduledExport,
  updateScheduledExport,
  deleteScheduledExport,
  executeScheduledExportNow,
} from '../controllers/analyticsFiltersController';

const router = Router();

router.use(protect);

router.get('/saved-filters', getSavedFilters);
router.post('/saved-filters', createSavedFilter);
router.put('/saved-filters/:id', updateSavedFilter);
router.delete('/saved-filters/:id', deleteSavedFilter);

router.get('/scheduled-exports', getScheduledExports);
router.post('/scheduled-exports', restrictTo('admin', 'moderator'), createScheduledExport);
router.put('/scheduled-exports/:id', restrictTo('admin', 'moderator'), updateScheduledExport);
router.delete('/scheduled-exports/:id', restrictTo('admin', 'moderator'), deleteScheduledExport);
router.post('/scheduled-exports/:id/execute', restrictTo('admin', 'moderator'), executeScheduledExportNow);

export default router;
