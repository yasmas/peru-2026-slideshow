// On macOS: clang -fobjc-arc -framework Foundation -framework Vision \
//   Web/tools/analyze_photos.m -o /tmp/analyze-peru-photos
// Run with Web/assets/photos as the first argument. Optional later arguments
// are individual JPEG filenames. The JSON is review material for motion_plan.json.
#import <Foundation/Foundation.h>
#import <Vision/Vision.h>

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 2) return 2;
        NSString *base = [NSString stringWithUTF8String:argv[1]];
        NSFileManager *files = [NSFileManager defaultManager];
        NSMutableArray<NSString *> *names = [NSMutableArray array];
        if (argc > 2) {
            for (int i = 2; i < argc; i++) [names addObject:[NSString stringWithUTF8String:argv[i]]];
        } else {
            for (NSString *name in [files contentsOfDirectoryAtPath:base error:nil]) {
                if ([[name.pathExtension lowercaseString] isEqualToString:@"jpg"]) [names addObject:name];
            }
            [names sortUsingSelector:@selector(compare:)];
        }
        NSMutableArray *results = [NSMutableArray array];
        for (NSString *name in names) {
            NSURL *url = [NSURL fileURLWithPath:[base stringByAppendingPathComponent:name]];
            VNDetectFaceRectanglesRequest *faceRequest = [VNDetectFaceRectanglesRequest new];
            VNDetectHumanRectanglesRequest *humanRequest = [VNDetectHumanRectanglesRequest new];
            VNClassifyImageRequest *classifyRequest = [VNClassifyImageRequest new];
            VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithURL:url options:@{}];
            NSError *error = nil;
            if (![handler performRequests:@[faceRequest, humanRequest, classifyRequest] error:&error]) {
                fprintf(stderr, "%s: %s\n", name.UTF8String, error.localizedDescription.UTF8String);
                continue;
            }
            NSMutableArray *faces = [NSMutableArray array];
            for (VNFaceObservation *face in faceRequest.results) {
                CGRect box = face.boundingBox;
                [faces addObject:@{@"x": @(box.origin.x), @"y": @(box.origin.y),
                                   @"width": @(box.size.width), @"height": @(box.size.height)}];
            }
            NSMutableArray *humans = [NSMutableArray array];
            for (VNHumanObservation *human in humanRequest.results) {
                CGRect box = human.boundingBox;
                [humans addObject:@{@"x": @(box.origin.x), @"y": @(box.origin.y),
                                    @"width": @(box.size.width), @"height": @(box.size.height)}];
            }
            NSMutableArray *labels = [NSMutableArray array];
            NSUInteger limit = MIN(classifyRequest.results.count, 12);
            for (NSUInteger i = 0; i < limit; i++) {
                VNClassificationObservation *label = classifyRequest.results[i];
                [labels addObject:@{@"name": label.identifier, @"confidence": @(label.confidence)}];
            }
            [results addObject:@{@"file": name, @"faces": faces, @"humans": humans, @"labels": labels}];
        }
        NSData *json = [NSJSONSerialization dataWithJSONObject:results options:NSJSONWritingPrettyPrinted error:nil];
        [[NSFileHandle fileHandleWithStandardOutput] writeData:json];
    }
    return 0;
}
